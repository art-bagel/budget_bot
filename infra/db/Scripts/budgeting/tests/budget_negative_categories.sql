-- Regular categories may go negative when budget moves out of them; the free
-- budget (Unallocated + FX Result) may not. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000701;
    ctx jsonb; account bigint; free bigint; a bigint; b bigint; g bigint; op bigint; blocked boolean := false;
BEGIN
    ctx := put__register_user_context(uid, 'RUB', NULL, 'Budget', 'Owner');
    account := (ctx->>'bank_account_id')::bigint;
    free := (ctx->>'unallocated_category_id')::bigint;
    a := put__create_category(uid, 'Источник', 'regular');
    b := put__create_category(uid, 'Получатель', 'regular');
    g := put__create_category(uid, 'Группа', 'group');
    PERFORM set__replace_group_members(uid, g, ARRAY[b], ARRAY[1]);
    PERFORM put__record_income(uid, account, 1000, 'RUB');
    PERFORM put__allocate_budget(uid, free, a, 300);

    -- 1. Category -> category below zero.
    op := put__allocate_budget(uid, a, b, 500);
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = a) = -200, 'source may go negative';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = b) = 500;

    -- 2. Category -> group below zero.
    PERFORM put__allocate_group_budget(uid, a, g, 100);
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = a) = -300;
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = b) = 600;

    -- 3. Reversal may take the destination below zero too.
    PERFORM put__record_expense(uid, account, b, 550, 'RUB');
    PERFORM put__reverse_operation(uid, op, NULL);
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = b) = -450, 'reversal: 50 - 500';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = a) = 200;

    -- 4. The free budget still cannot be overspent.
    BEGIN
        PERFORM put__allocate_budget(uid, free, a, 701);
    EXCEPTION WHEN raise_exception THEN blocked := true;
    END;
    ASSERT blocked, 'free budget 700 must not allocate 701';
    ASSERT (SELECT sum(amount) FROM current_budget_balances WHERE category_id IN (free, a, b)) = 450,
        'budget total equals the bank: 1000 income - 550 expense';
END $$;
ROLLBACK;
