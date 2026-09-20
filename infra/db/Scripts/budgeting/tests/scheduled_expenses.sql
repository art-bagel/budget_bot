-- Сценарный тест захвата запланированных расходов.
--
-- Запуск на локальном docker-стеке:
--   docker exec budget_bot_db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
--       -d "$POSTGRES_DB" -f /Scripts/budgeting/tests/scheduled_expenses.sql'
--
-- Главное, что проверяется: строку нельзя захватить дважды. Именно на этом
-- раньше возникало двойное списание — два инстанса API читали один и тот же
-- список, либо процесс падал между записью расхода и сдвигом даты.
--
-- Тест пишет в базу и убирает за собой — гонять на dev, не на проде.
SET search_path TO budgeting;

DO $$
DECLARE
    _user_id bigint := 990000000101;
    _account_id bigint;
    _category_id bigint;
    _schedule_weekly bigint;
    _schedule_monthly bigint;
    _schedule_orphan bigint;
    _claimed jsonb;
    _row jsonb;
    _next date;
BEGIN
    INSERT INTO currencies (code, name) VALUES ('RUB', 'Российский рубль')
    ON CONFLICT (code) DO NOTHING;

    PERFORM put__register_user_context(_user_id, 'RUB', NULL, 'Sched', 'Test');

    SELECT id INTO _account_id
    FROM bank_accounts
    WHERE owner_type = 'user' AND owner_user_id = _user_id AND is_primary;

    SELECT id INTO _category_id
    FROM categories
    WHERE owner_type = 'user' AND owner_user_id = _user_id AND name = 'Unallocated';

    ASSERT _account_id IS NOT NULL, 'у нового пользователя есть основной счёт';
    ASSERT _category_id IS NOT NULL, 'у нового пользователя есть Unallocated';

    -- ── Подготовка: три расписания, все просрочены ──────────────────────
    INSERT INTO scheduled_expenses (
        owner_type, owner_user_id, category_id, created_by_user_id,
        amount, currency_code, frequency, day_of_week, next_run_at, is_active
    )
    VALUES ('user', _user_id, _category_id, _user_id,
            100, 'RUB', 'weekly', 3, CURRENT_DATE - 1, TRUE)
    RETURNING id INTO _schedule_weekly;

    -- 31-е число: следующий месяц может быть короче, дата должна прижаться
    -- к последнему дню, а не уехать в никуда.
    INSERT INTO scheduled_expenses (
        owner_type, owner_user_id, category_id, created_by_user_id,
        amount, currency_code, frequency, day_of_month, next_run_at, is_active
    )
    VALUES ('user', _user_id, _category_id, _user_id,
            200, 'RUB', 'monthly', 31, DATE '2026-01-31', TRUE)
    RETURNING id INTO _schedule_monthly;

    -- ── 1. Первый захват отдаёт обе строки ──────────────────────────────
    _claimed := put__claim_due_scheduled_expenses();

    ASSERT jsonb_array_length(_claimed) = 2,
        format('первый захват должен вернуть 2 строки, вернул %s', jsonb_array_length(_claimed));

    SELECT value INTO _row
    FROM jsonb_array_elements(_claimed)
    WHERE (value->>'id')::bigint = _schedule_weekly;

    ASSERT (_row->>'bank_account_id')::bigint = _account_id,
        'основной наличный счёт владельца подставлен в захваченную строку';
    ASSERT (_row->>'amount')::numeric = 100, 'сумма приехала как есть';

    -- ── 2. Даты сдвинулись правильно ────────────────────────────────────
    SELECT next_run_at INTO _next FROM scheduled_expenses WHERE id = _schedule_weekly;
    ASSERT _next = CURRENT_DATE - 1 + 7,
        format('weekly сдвигается на 7 дней, получилось %s', _next);

    SELECT next_run_at INTO _next FROM scheduled_expenses WHERE id = _schedule_monthly;
    ASSERT _next = DATE '2026-02-28',
        format('31 января + месяц прижимается к 28 февраля, получилось %s', _next);

    SELECT last_run_at INTO _next FROM scheduled_expenses WHERE id = _schedule_weekly;
    ASSERT _next = CURRENT_DATE, 'last_run_at проставляется при захвате';

    -- ── 3. Догоняющее списание ──────────────────────────────────────────
    -- Сдвиг всегда ровно на один период. Значит, расписание, просроченное на
    -- несколько периодов (сервер долго лежал), будет захватываться на каждом
    -- проходе, пока не догонит сегодняшний день, — и спишет столько раз,
    -- сколько периодов пропущено. Поведение то же, что и до атомарного
    -- захвата; фиксируем его явно, чтобы изменение не прошло незамеченным.
    _claimed := put__claim_due_scheduled_expenses();
    ASSERT jsonb_array_length(_claimed) = 1,
        'просроченное на месяцы расписание берётся снова, пока не догонит';
    ASSERT (_claimed->0->>'id')::bigint = _schedule_monthly,
        'догоняет именно просроченное, а не уже сдвинутое в будущее';

    -- Убираем его с дороги, чтобы дальше проверять захват в чистом виде.
    UPDATE scheduled_expenses SET is_active = FALSE WHERE id = _schedule_monthly;

    -- ── 4. Повторный захват не отдаёт ничего ────────────────────────────
    -- Это и есть защита от двойного списания: дата уже сдвинута той же
    -- операцией, которой строка была прочитана.
    _claimed := put__claim_due_scheduled_expenses();
    ASSERT jsonb_array_length(_claimed) = 0,
        format('повторный захват должен вернуть 0 строк, вернул %s', jsonb_array_length(_claimed));

    -- ── 5. Итог исполнения пишется отдельно и даты не трогает ───────────
    PERFORM set__scheduled_expense_run_result(_schedule_weekly, 'что-то пошло не так');
    ASSERT (SELECT last_error FROM scheduled_expenses WHERE id = _schedule_weekly)
           = 'что-то пошло не так', 'ошибка сохраняется';

    PERFORM set__scheduled_expense_run_result(_schedule_weekly, NULL);
    ASSERT (SELECT last_error FROM scheduled_expenses WHERE id = _schedule_weekly) IS NULL,
        'успех чистит прошлую ошибку';

    SELECT next_run_at INTO _next FROM scheduled_expenses WHERE id = _schedule_weekly;
    ASSERT _next = CURRENT_DATE - 1 + 7,
        'запись итога не должна сдвигать дату второй раз';

    -- ── 6. Неактивные расписания не захватываются ───────────────────────
    UPDATE scheduled_expenses
    SET next_run_at = CURRENT_DATE - 1, is_active = FALSE
    WHERE id = _schedule_weekly;

    _claimed := put__claim_due_scheduled_expenses();
    ASSERT jsonb_array_length(_claimed) = 0, 'неактивное расписание не захватывается';

    -- ── 7. Расписание без основного счёта всё равно захватывается ───────
    -- Раньше INNER JOIN выкидывал такую строку из выборки: она не списывалась,
    -- не сдвигалась и висела просроченной вечно, никак себя не проявляя.
    UPDATE bank_accounts SET is_primary = FALSE WHERE id = _account_id;

    INSERT INTO scheduled_expenses (
        owner_type, owner_user_id, category_id, created_by_user_id,
        amount, currency_code, frequency, day_of_week, next_run_at, is_active
    )
    VALUES ('user', _user_id, _category_id, _user_id,
            300, 'RUB', 'weekly', 1, CURRENT_DATE - 1, TRUE)
    RETURNING id INTO _schedule_orphan;

    _claimed := put__claim_due_scheduled_expenses();
    ASSERT jsonb_array_length(_claimed) = 1, 'строка без основного счёта попадает в захват';
    ASSERT _claimed->0->>'bank_account_id' IS NULL,
        'и приезжает с bank_account_id = null, чтобы вызывающий записал ошибку';

    SELECT next_run_at INTO _next FROM scheduled_expenses WHERE id = _schedule_orphan;
    ASSERT _next = CURRENT_DATE - 1 + 7, 'она тоже сдвигается, а не зависает просроченной';

    -- ── Уборка ──────────────────────────────────────────────────────────
    DELETE FROM scheduled_expenses WHERE created_by_user_id = _user_id;
    PERFORM set__delete_user_account(_user_id);

    RAISE NOTICE 'scheduled_expenses: все проверки пройдены';
END
$$;
