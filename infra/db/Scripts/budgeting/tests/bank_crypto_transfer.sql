-- Personal <-> family transfers of banking crypto and foreign currency.
-- Self-contained for CI; every fixture and change is rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000601;
    stranger bigint := 990000000602;
    me jsonb; fam jsonb; asset bigint; op jsonb; back jsonb;
    personal bigint; family bigint; p_free bigint; f_free bigint;
    lot_cheap bigint; blocked boolean;
    guard integer;
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Crypto', 'Owner');
    PERFORM put__register_user_context(stranger, 'RUB', NULL, 'Other', 'User');
    fam := put__create_family(uid, 'Test family');
    personal := (me->>'bank_account_id')::bigint;
    p_free := (me->>'unallocated_category_id')::bigint;
    family := (fam->>'bank_account_id')::bigint;
    f_free := (fam->>'unallocated_category_id')::bigint;
    asset := (put__ensure_crypto_asset('TTRF', 'Transfer test', 'ton', '0:bank-crypto-transfer-test', 6::smallint, '{}'::jsonb)->>'id')::bigint;

    PERFORM put__record_income(uid, personal, 20000, 'RUB');
    PERFORM put__buy_crypto_asset(uid, personal, 'RUB', 10000, asset, 100);  -- 100 per unit
    PERFORM put__buy_crypto_asset(uid, personal, 'RUB', 5000, asset, 25);    -- 200 per unit
    SELECT id INTO lot_cheap FROM crypto_lots WHERE bank_account_id = personal ORDER BY created_at, id LIMIT 1;
    -- Units already spent outside the bot, waiting for an expense category.
    UPDATE crypto_lots SET metadata = metadata || '{"reserved_for_manual_expense": true}' WHERE id = lot_cheap;

    -- 1. Personal -> family: FIFO cost moves with the crypto into family free budget.
    op := put__transfer_bank_crypto(uid, personal, family, asset, 110, 'В семью');
    ASSERT (op->>'cost_base')::numeric = 12000, format('100*100 + 10*200 = 12000, got %s', op->>'cost_base');
    ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id = personal AND crypto_asset_id = asset) = 15;
    ASSERT (SELECT cost_base_remaining FROM current_crypto_balances WHERE bank_account_id = personal AND crypto_asset_id = asset) = 3000;
    ASSERT (SELECT (amount, cost_base_remaining) = (110::numeric, 12000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = family AND crypto_asset_id = asset), 'family holds 110 at 12000';
    ASSERT (SELECT amount_remaining FROM crypto_lots WHERE id = lot_cheap) = 0, 'oldest lot consumed first';
    ASSERT (SELECT count(*) FROM crypto_lots WHERE bank_account_id = family AND amount_remaining = 100
            AND (metadata->>'reserved_for_manual_expense')::boolean
            AND created_at = (SELECT created_at FROM crypto_lots WHERE id = lot_cheap)) = 1,
        'lots move with their cost, FIFO date and pending-expense mark';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = p_free AND currency_code = 'RUB') = 8000,
        'personal free: 20000 - 12000';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = f_free AND currency_code = 'RUB') = 12000,
        'family free receives the cost';
    ASSERT (SELECT count(*) FROM operations WHERE type = 'income' AND owner_family_id = (fam->>'family_id')::bigint) = 0,
        'no income is created';

    -- 2. Family -> personal, partial lot: FIFO of the original lots, not an average.
    back := put__transfer_bank_crypto(uid, family, personal, asset, 11);
    ASSERT (back->>'cost_base')::numeric = 1100, format('11 * 100 = 1100, got %s', back->>'cost_base');
    ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id = personal AND crypto_asset_id = asset) = 26;

    -- 3. Reversal restores both sides, including budgets. Personal Unallocated
    -- may be negative while Unallocated + FX Result stays positive.
    PERFORM put__apply_current_budget_delta(p_free, 'RUB', -20000);
    PERFORM put__apply_current_budget_delta((me->>'fx_result_category_id')::bigint, 'RUB', 20000);
    PERFORM put__reverse_operation(uid, (back->>'operation_id')::bigint, NULL);
    ASSERT (SELECT (amount, cost_base_remaining) = (110::numeric, 12000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = family AND crypto_asset_id = asset), 'reversal restores family';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = f_free AND currency_code = 'RUB') = 12000;
    ASSERT (SELECT sum(amount_remaining) FROM crypto_lots WHERE bank_account_id = personal AND crypto_asset_id = asset) = 15;

    -- 4. Lots always equal the balance projection.
    ASSERT NOT EXISTS (SELECT 1 FROM current_crypto_balances b
        JOIN (SELECT bank_account_id, sum(amount_remaining) q, sum(cost_base_remaining) c FROM crypto_lots
              WHERE crypto_asset_id = asset GROUP BY 1) l USING (bank_account_id)
        WHERE b.crypto_asset_id = asset AND (b.amount <> l.q OR b.cost_base_remaining <> l.c));

    -- 5. Guards: balance, strangers, account kind, same account, base currency.
    FOR guard IN 1..5 LOOP
        blocked := false;
        BEGIN
            CASE guard
            WHEN 1 THEN PERFORM put__transfer_bank_crypto(uid, personal, family, asset, 16);
            WHEN 2 THEN PERFORM put__transfer_bank_crypto(stranger, personal, family, asset, 1);
            WHEN 3 THEN PERFORM put__transfer_bank_crypto(uid, personal, family, asset, 0);
            WHEN 4 THEN PERFORM put__transfer_bank_crypto(uid, personal, personal, asset, 1);
            WHEN 5 THEN
                UPDATE families SET base_currency_code = 'USD' WHERE id = (fam->>'family_id')::bigint;
                PERFORM put__transfer_bank_crypto(uid, personal, family, asset, 1);
            END CASE;
        EXCEPTION WHEN raise_exception THEN blocked := true;
        END;
        ASSERT blocked, format('guard %s must reject the transfer', guard);
    END LOOP;
END $$;
ROLLBACK;

-- Foreign currency personal <-> family keeps lot cost; different bases are rejected.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000611;
    me jsonb; fam jsonb; personal bigint; family bigint; op jsonb; blocked boolean := false;
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Fx', 'Owner');
    fam := put__create_family(uid, 'Fx family');
    personal := (me->>'bank_account_id')::bigint;
    family := (fam->>'bank_account_id')::bigint;
    PERFORM put__record_income(uid, personal, 100, 'USD', NULL, 8000);
    op := put__transfer_between_accounts(uid, personal, family, 'USD', 40);
    ASSERT (op->>'amount_in_base')::numeric = 3200, format('40 USD at 80 = 3200, got %s', op->>'amount_in_base');
    ASSERT (SELECT (amount, historical_cost_in_base) = (40::numeric, 3200::numeric) FROM current_bank_balances
            WHERE bank_account_id = family AND currency_code = 'USD'), 'family receives USD with its cost';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = (fam->>'unallocated_category_id')::bigint) = 3200;
    UPDATE families SET base_currency_code = 'USD' WHERE id = (fam->>'family_id')::bigint;
    BEGIN
        PERFORM put__transfer_between_accounts(uid, personal, family, 'USD', 1);
    EXCEPTION WHEN raise_exception THEN blocked := true;
    END;
    ASSERT blocked, 'different base currencies must be rejected';
END $$;
ROLLBACK;
