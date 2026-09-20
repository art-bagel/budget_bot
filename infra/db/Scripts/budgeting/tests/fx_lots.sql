-- Сценарный тест FX-лотов: FIFO, себестоимость и обмен валюты.
--
-- Запуск на локальном docker-стеке:
--   docker exec budget_bot_db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
--       -d "$POSTGRES_DB" -f /Scripts/budgeting/tests/fx_lots.sql'
--
-- Здесь проверяется то, что нельзя увидеть глазами в UI и что дороже всего
-- сломать: на бюджет валютного расхода влияет ИСТОРИЧЕСКАЯ себестоимость
-- потреблённых лотов, а не текущий курс. Ошибка тут не падает с исключением,
-- а тихо искажает все отчёты.
--
-- Отдельно закреплён денежный инвариант: сумма списанных себестоимостей по
-- лоту в точности равна его исходной стоимости. Ни копейки не теряется и не
-- появляется, сколько бы частичных расходов лот ни пережил.
--
-- Тест пишет в базу и убирает за собой — гонять на dev, не на проде.
SET search_path TO budgeting;

DO $$
DECLARE
    _user_id     bigint := 990000000401;
    _ctx         jsonb;
    _account_id  bigint;
    _unallocated bigint;
    _travel      bigint;
    _fx_result   bigint;
    _op          jsonb;
    _expense_op  bigint;
    _lot_cheap   bigint;
    _lot_dear    bigint;
    _bank        numeric;
    _budget      numeric;
    _cost        numeric;
    _remaining   numeric;
    _guard       boolean;
    _err         text;
BEGIN
    _ctx := put__register_user_context(_user_id, 'RUB', NULL, 'FX', 'Test');
    _account_id  := (_ctx->>'bank_account_id')::bigint;
    _unallocated := (_ctx->>'unallocated_category_id')::bigint;
    _fx_result   := (_ctx->>'fx_result_category_id')::bigint;
    _travel      := put__create_category(_user_id, 'Путешествия', 'regular');

    -- ── 1. Валютный доход создаёт лот с зафиксированным курсом ──────────
    -- 100 USD, бюджетная стоимость 8000 RUB → курс лота 80 RUB/USD.
    PERFORM put__record_income(_user_id, _account_id, 100, 'USD', NULL, 8000);

    SELECT id, amount_remaining, cost_base_remaining
      INTO _lot_cheap, _remaining, _cost
    FROM fx_lots WHERE bank_account_id = _account_id AND currency_code = 'USD';

    ASSERT _lot_cheap IS NOT NULL, 'валютный доход создаёт FX-лот';
    ASSERT _remaining = 100, format('в лоте 100 USD, получено %s', _remaining);
    ASSERT _cost = 8000, format('себестоимость лота 8000 RUB, получено %s', _cost);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _unallocated AND currency_code = 'RUB';
    ASSERT _budget = 8000, format('бюджет пополняется в базовой валюте, получено %s', _budget);

    -- ── 2. Второй доход дороже — отдельный лот ──────────────────────────
    -- 100 USD за 10000 RUB → курс 100 RUB/USD. Доллар подорожал.
    PERFORM put__record_income(_user_id, _account_id, 100, 'USD', NULL, 10000);

    SELECT id INTO _lot_dear
    FROM fx_lots WHERE bank_account_id = _account_id AND currency_code = 'USD' AND id <> _lot_cheap;

    ASSERT _lot_dear IS NOT NULL, 'второй доход создаёт второй лот, а не доливает первый';
    ASSERT (SELECT count(*) FROM fx_lots WHERE bank_account_id = _account_id) = 2,
        'лотов ровно два';

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'USD';
    ASSERT _bank = 200, format('на счёте 200 USD, получено %s', _bank);

    -- ── 3. Расход потребляет ДЕШЁВЫЙ лот первым (FIFO) ──────────────────
    -- Тратим 50 USD. По FIFO берётся первый лот по курсу 80 → 4000 RUB.
    -- Если бы брался второй (100 RUB/USD) — вышло бы 5000, и отчёты о
    -- тратах поехали бы на 25%, ничего при этом не уронив.
    PERFORM put__allocate_budget(_user_id, _unallocated, _travel, 18000);
    _op := put__record_expense(_user_id, _account_id, _travel, 50, 'USD');
    _expense_op := (_op->>'operation_id')::bigint;

    ASSERT (_op->>'expense_cost_in_base')::numeric = 4000,
        format('FIFO берёт дешёвый лот: ожидали 4000 RUB, получили %s',
               _op->>'expense_cost_in_base');

    SELECT amount_remaining, cost_base_remaining INTO _remaining, _cost
    FROM fx_lots WHERE id = _lot_cheap;
    ASSERT _remaining = 50, format('в дешёвом лоте осталось 50 USD, получено %s', _remaining);
    ASSERT _cost = 4000, format('и 4000 RUB себестоимости, получено %s', _cost);

    ASSERT (SELECT amount_remaining FROM fx_lots WHERE id = _lot_dear) = 100,
        'дорогой лот не тронут, пока не исчерпан дешёвый';

    ASSERT (SELECT count(*) FROM lot_consumptions WHERE operation_id = _expense_op) = 1,
        'потребление записано одной строкой';

    -- ── 4. Расход через границу лотов ───────────────────────────────────
    -- Тратим 100 USD: 50 добивают дешёвый лот (4000) + 50 из дорогого
    -- (10000 * 50/100 = 5000). Итого 9000 RUB.
    _op := put__record_expense(_user_id, _account_id, _travel, 100, 'USD');

    ASSERT (_op->>'expense_cost_in_base')::numeric = 9000,
        format('расход через два лота = 9000 RUB, получено %s', _op->>'expense_cost_in_base');

    SELECT amount_remaining, cost_base_remaining INTO _remaining, _cost
    FROM fx_lots WHERE id = _lot_cheap;
    ASSERT _remaining = 0, 'дешёвый лот исчерпан';
    ASSERT _cost = 0, format('и его себестоимость обнулена, получено %s', _cost);

    ASSERT (SELECT count(*) FROM lot_consumptions
            WHERE operation_id = (_op->>'operation_id')::bigint) = 2,
        'расход через границу лотов пишет два потребления';

    -- ── 5. Дробление лота не теряет и не создаёт копейки ────────────────
    -- Сумма, которая заведомо не делится нацело: 3 EUR за 1000 RUB, тратим
    -- по 1 EUR. Каждое частичное списание округляется до копейки
    -- (333.33, потом 333.34), но остаток всегда переносится в лот, поэтому
    -- итог обязан сойтись ровно в 1000.00.
    --
    -- Прим.: ветку «при полном потреблении брать остаток целиком» этот тест
    -- отличить не может, и никакой другой тест не сможет. cost_base_remaining
    -- хранится как numeric(20,2), поэтому round(cost * amt/amt, 2) = cost
    -- тождественно — обе формулы дают один результат. Ветка защитная, а не
    -- работающая; смысл имеет именно инвариант ниже.
    PERFORM put__record_income(_user_id, _account_id, 3, 'EUR', NULL, 1000);

    PERFORM put__record_expense(_user_id, _account_id, _travel, 1, 'EUR');
    PERFORM put__record_expense(_user_id, _account_id, _travel, 1, 'EUR');
    _op := put__record_expense(_user_id, _account_id, _travel, 1, 'EUR');

    SELECT cost_base_remaining INTO _cost
    FROM fx_lots WHERE bank_account_id = _account_id AND currency_code = 'EUR';
    ASSERT _cost = 0,
        format('полностью потреблённый лот обнуляется без остатка копеек, получено %s', _cost);

    SELECT COALESCE(sum(cost_base), 0) INTO _cost
    FROM lot_consumptions lc
    JOIN fx_lots l ON l.id = lc.lot_id
    WHERE l.bank_account_id = _account_id AND l.currency_code = 'EUR';
    ASSERT _cost = 1000,
        format('сумма потреблённых стоимостей равна стоимости лота, получено %s', _cost);

    -- ── 6. Реверс валютного расхода возвращает лот ──────────────────────
    PERFORM put__reverse_operation(_user_id, _expense_op);

    SELECT amount_remaining, cost_base_remaining INTO _remaining, _cost
    FROM fx_lots WHERE id = _lot_cheap;
    ASSERT _remaining = 50, format('реверс вернул 50 USD в лот, получено %s', _remaining);
    ASSERT _cost = 4000, format('и 4000 RUB себестоимости, получено %s', _cost);

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'USD';
    ASSERT _bank = 100, format('на счёте снова 100 USD, получено %s', _bank);

    -- ── 7. Обмен валюты меняет банк, но не двигает бюджет по категориям ─
    -- Продаём 50 USD за 6000 RUB. Себестоимость этих долларов — 4000 RUB
    -- (дешёвый лот), значит реализованная прибыль 2000 RUB и уходит она
    -- в системную категорию FX Result, а не в Путешествия.
    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _travel AND currency_code = 'RUB';

    PERFORM put__exchange_currency(_user_id, _account_id, 'USD', 50, 'RUB', 6000);

    ASSERT (SELECT amount FROM current_budget_balances
            WHERE category_id = _travel AND currency_code = 'RUB') = _budget,
        'обмен не трогает обычные категории';

    SELECT amount INTO _cost FROM current_budget_balances
    WHERE category_id = _fx_result AND currency_code = 'RUB';
    ASSERT _cost = 2000,
        format('реализованный FX-результат 2000 RUB уходит в FX Result, получено %s', _cost);

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'USD';
    ASSERT _bank = 50, format('после продажи осталось 50 USD, получено %s', _bank);

    -- ── 8. Нельзя потратить больше валюты, чем есть ─────────────────────
    _guard := false;
    BEGIN
        PERFORM put__record_expense(_user_id, _account_id, _travel, 9999, 'USD');
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'валютный расход сверх остатка должен падать';
    ASSERT _err LIKE '%превышает остаток%', format('ожидали нехватку валюты, получили: %s', _err);

    -- ── 9. Лоты сходятся с балансом счёта ───────────────────────────────
    -- Если остатки по лотам разошлись с current_bank_balances, значит
    -- какая-то операция тронула один слой мимо другого.
    SELECT COALESCE(sum(amount_remaining), 0) INTO _remaining
    FROM fx_lots WHERE bank_account_id = _account_id AND currency_code = 'USD';

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'USD';

    ASSERT _remaining = _bank,
        format('сумма остатков лотов (%s) равна балансу счёта (%s)', _remaining, _bank);

    -- ── Уборка ──────────────────────────────────────────────────────────
    PERFORM set__delete_user_account(_user_id);

    RAISE NOTICE 'fx_lots: все проверки пройдены';
END
$$;
