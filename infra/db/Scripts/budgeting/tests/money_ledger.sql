-- Сценарный тест базового денежного цикла в базовой валюте.
--
-- Запуск на локальном docker-стеке:
--   docker exec budget_bot_db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
--       -d "$POSTGRES_DB" -f /Scripts/budgeting/tests/money_ledger.sql'
--
-- Проверяет главное свойство модели: банк и бюджет — два независимых слоя,
-- и каждая операция двигает ровно те из них, которые должна.
--   доход     — банк вверх, Unallocated вверх;
--   allocate  — только бюджет, банк не трогается;
--   расход    — оба слоя вниз;
--   реверс    — оба слоя возвращаются ровно к прежним значениям.
-- Плюс проверки доступа: чужой счёт, чужая категория, нехватка денег.
--
-- Тест пишет в базу и убирает за собой — гонять на dev, не на проде.
SET search_path TO budgeting;

DO $$
DECLARE
    _user_id     bigint := 990000000301;
    _other_id    bigint := 990000000302;
    _ctx         jsonb;
    _account_id  bigint;
    _unallocated bigint;
    _groceries   bigint;
    _other_acc   bigint;
    _other_cat   bigint;
    _op          jsonb;
    _expense_op  bigint;
    _bank        numeric;
    _budget      numeric;
    _guard       boolean;
    _err         text;
BEGIN
    -- ── Фикстуры ────────────────────────────────────────────────────────
    _ctx := put__register_user_context(_user_id, 'RUB', NULL, 'Ledger', 'Test');
    _account_id  := (_ctx->>'bank_account_id')::bigint;
    _unallocated := (_ctx->>'unallocated_category_id')::bigint;
    _groceries   := put__create_category(_user_id, 'Продукты', 'regular');

    _ctx := put__register_user_context(_other_id, 'RUB', NULL, 'Other', 'User');
    _other_acc := (_ctx->>'bank_account_id')::bigint;
    _other_cat := put__create_category(_other_id, 'Чужая категория', 'regular');

    -- ── 1. Доход поднимает и банк, и Unallocated ────────────────────────
    PERFORM put__record_income(_user_id, _account_id, 50000, 'RUB');

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'RUB';
    ASSERT _bank = 50000, format('банк после дохода = 50000, получено %s', _bank);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _unallocated AND currency_code = 'RUB';
    ASSERT _budget = 50000, format('Unallocated после дохода = 50000, получено %s', _budget);

    -- В базовой валюте FX-лоты не заводятся: конвертировать нечего.
    ASSERT (SELECT count(*) FROM fx_lots WHERE bank_account_id = _account_id) = 0,
        'доход в базовой валюте не создаёт FX-лот';

    -- ── 2. Allocate двигает только бюджет ───────────────────────────────
    PERFORM put__allocate_budget(_user_id, _unallocated, _groceries, 12000);

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'RUB';
    ASSERT _bank = 50000, format('allocate не трогает банк, стало %s', _bank);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _unallocated AND currency_code = 'RUB';
    ASSERT _budget = 38000, format('Unallocated после allocate = 38000, получено %s', _budget);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _groceries AND currency_code = 'RUB';
    ASSERT _budget = 12000, format('Продукты после allocate = 12000, получено %s', _budget);

    -- ── 3. Расход опускает оба слоя ─────────────────────────────────────
    _op := put__record_expense(_user_id, _account_id, _groceries, 3500, 'RUB');
    _expense_op := (_op->>'operation_id')::bigint;

    ASSERT (_op->>'expense_cost_in_base')::numeric = 3500,
        'в базовой валюте себестоимость равна сумме';

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'RUB';
    ASSERT _bank = 46500, format('банк после расхода = 46500, получено %s', _bank);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _groceries AND currency_code = 'RUB';
    ASSERT _budget = 8500, format('Продукты после расхода = 8500, получено %s', _budget);

    -- Категория может уйти в минус: тратить позволяет счёт, а не конверт.
    PERFORM put__record_expense(_user_id, _account_id, _groceries, 10000, 'RUB');
    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _groceries AND currency_code = 'RUB';
    ASSERT _budget = -1500, format('категория уходит в минус, получено %s', _budget);

    -- ── 4. Реверс возвращает оба слоя ровно назад ───────────────────────
    PERFORM put__reverse_operation(_user_id, _expense_op);

    SELECT amount INTO _bank FROM current_bank_balances
    WHERE bank_account_id = _account_id AND currency_code = 'RUB';
    ASSERT _bank = 40000, format('банк после реверса = 40000, получено %s', _bank);

    SELECT amount INTO _budget FROM current_budget_balances
    WHERE category_id = _groceries AND currency_code = 'RUB';
    ASSERT _budget = 2000, format('Продукты после реверса = 2000, получено %s', _budget);

    -- Реверс не удаляет историю, а добавляет зеркальную операцию.
    ASSERT (SELECT count(*) FROM operations
            WHERE reversal_of_operation_id = _expense_op) = 1,
        'реверс создаёт отдельную операцию со ссылкой на оригинал';

    ASSERT (SELECT count(*) FROM operations WHERE id = _expense_op) = 1,
        'оригинальная операция остаётся в истории';

    -- ── 5. Нельзя потратить больше, чем есть на счёте ───────────────────
    -- Ошибку сверяем по тексту, а не просто ловим любую: иначе опечатка в
    -- аргументах дала бы «function does not exist», и проверка прошла бы по
    -- неверной причине. Один раз так и получилось при написании теста.
    _guard := false;
    BEGIN
        PERFORM put__record_expense(_user_id, _account_id, _groceries, 999999, 'RUB');
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'расход сверх остатка счёта должен падать';
    ASSERT _err LIKE '%превышает остаток%', format('ожидали нехватку денег, получили: %s', _err);

    -- ── 6. Чужие счета и категории недоступны ───────────────────────────
    _guard := false;
    BEGIN
        PERFORM put__record_expense(_user_id, _other_acc, _groceries, 100, 'RUB');
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'расход с чужого счёта должен падать';
    ASSERT _err LIKE '%Access denied%' OR _err LIKE '%same owner%',
        format('ожидали отказ в доступе к счёту, получили: %s', _err);

    _guard := false;
    BEGIN
        PERFORM put__record_expense(_user_id, _account_id, _other_cat, 100, 'RUB');
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'расход в чужую категорию должен падать';
    ASSERT _err LIKE '%Access denied%' OR _err LIKE '%same owner%',
        format('ожидали отказ в доступе к категории, получили: %s', _err);

    _guard := false;
    BEGIN
        PERFORM put__allocate_budget(_user_id, _unallocated, _other_cat, 100);
    EXCEPTION WHEN others THEN
        _guard := true; _err := SQLERRM;
    END;
    ASSERT _guard, 'перевод бюджета в чужую категорию должен падать';
    ASSERT _err LIKE '%Access denied%' OR _err LIKE '%different owners%',
        format('ожидали отказ в переводе бюджета, получили: %s', _err);

    -- ── 7. Банк и бюджет сходятся с журналом ────────────────────────────
    -- current_* — это проекции; если они разошлись с bank_entries и
    -- budget_entries, значит какая-то функция обновила проекцию мимо журнала.
    SELECT COALESCE(sum(be.amount), 0) INTO _bank
    FROM bank_entries be WHERE be.bank_account_id = _account_id AND be.currency_code = 'RUB';

    ASSERT _bank = (SELECT amount FROM current_bank_balances
                    WHERE bank_account_id = _account_id AND currency_code = 'RUB'),
        'проекция банка совпадает с суммой bank_entries';

    SELECT COALESCE(sum(bge.amount), 0) INTO _budget
    FROM budget_entries bge WHERE bge.category_id = _groceries;

    ASSERT _budget = (SELECT amount FROM current_budget_balances
                      WHERE category_id = _groceries AND currency_code = 'RUB'),
        'проекция бюджета совпадает с суммой budget_entries';

    -- ── Уборка ──────────────────────────────────────────────────────────
    PERFORM set__delete_user_account(_user_id);
    PERFORM set__delete_user_account(_other_id);

    RAISE NOTICE 'money_ledger: все проверки пройдены';
END
$$;
