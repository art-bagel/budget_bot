-- Bank crypto -> crypto exchange through the bank journal: FIFO cost carries
-- into the received coin, pending-expense units are skipped, the request is
-- idempotent and reversible. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000801;
    me jsonb; bank bigint; free bigint; usdt bigint; usdc bigint;
    req uuid := gen_random_uuid(); op jsonb; again jsonb; err text := '';
    swap jsonb; free_before numeric; ops bigint;
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Swap', 'Owner');
    bank := (me->>'bank_account_id')::bigint;
    free := (me->>'unallocated_category_id')::bigint;
    usdt := (put__ensure_crypto_asset('TUSDT', 'Swap from', 'ton', '0:bank-swap-from', 6::smallint, '{}'::jsonb)->>'id')::bigint;
    usdc := (put__ensure_crypto_asset('TUSDC', 'Swap to', 'arbitrum', '0:bank-swap-to', 6::smallint, '{}'::jsonb)->>'id')::bigint;

    PERFORM put__record_income(uid, bank, 50000, 'RUB');
    PERFORM put__buy_crypto_asset(uid, bank, 'RUB', 2000, usdt, 20);    -- spent outside the bot
    PERFORM put__buy_crypto_asset(uid, bank, 'RUB', 10000, usdt, 100);  -- 100 per unit
    PERFORM put__buy_crypto_asset(uid, bank, 'RUB', 10000, usdt, 50);   -- 200 per unit
    UPDATE crypto_lots SET metadata = metadata || '{"reserved_for_manual_expense": true}'
    WHERE id = (SELECT min(id) FROM crypto_lots WHERE bank_account_id = bank AND crypto_asset_id = usdt);

    -- 1. 120 USDT -> 119 USDC: reserved units skipped, FIFO cost 100*100 + 20*200 carried.
    free_before := (SELECT amount FROM current_budget_balances WHERE category_id = free);
    swap := jsonb_build_object('bank_account_id', bank, 'from_crypto_asset_id', usdt, 'from_quantity', '120',
        'to_crypto_asset_id', usdc, 'to_quantity', '119', 'operated_at', current_date);
    op := put__journal_bank_operation(uid, bank, 'bank_swap', swap, req);
    ASSERT (op->>'cost_base')::numeric = 14000, format('carried cost 14000, got %s', op->>'cost_base');
    ASSERT (SELECT (amount, cost_base_remaining) = (119::numeric, 14000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = bank AND crypto_asset_id = usdc), 'USDC 119 at 14000';
    ASSERT (SELECT (amount, cost_base_remaining) = (50::numeric, 8000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = bank AND crypto_asset_id = usdt), 'USDT left: 20 reserved + 30 at 200';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = free_before,
        'free budget unchanged';
    ASSERT NOT EXISTS (SELECT 1 FROM budget_entries WHERE operation_id = (op->>'operation_id')::bigint),
        'no income, expense or FX result';

    -- 2. The same request is idempotent.
    ops := (SELECT count(*) FROM operations WHERE owner_user_id = uid);
    again := put__journal_bank_operation(uid, bank, 'bank_swap', swap, req);
    ASSERT again->>'operation_id' = op->>'operation_id', 'repeat returns the same operation';
    ASSERT (SELECT count(*) FROM operations WHERE owner_user_id = uid) = ops, 'repeat adds no operation';

    -- 3. Pending-expense units are not exchangeable, and the error says so.
    BEGIN
        PERFORM put__journal_bank_operation(uid, bank, 'bank_swap',
            swap || '{"from_quantity": "31", "to_quantity": "31"}', gen_random_uuid());
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE '%20 TUSDT уже потрачены вне бота%', format('reserved units named, got "%s"', err);

    -- 4. Reversal restores the given coin and removes the received one.
    PERFORM put__reverse_operation(uid, (op->>'operation_id')::bigint, NULL);
    ASSERT (SELECT (amount, cost_base_remaining) = (170::numeric, 22000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = bank AND crypto_asset_id = usdt), 'USDT restored';
    ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id = bank AND crypto_asset_id = usdc), 0) = 0,
        'USDC removed';

    -- 5. Lots always equal the balance projection.
    ASSERT NOT EXISTS (SELECT 1 FROM current_crypto_balances b
        JOIN (SELECT crypto_asset_id, sum(amount_remaining) q, sum(cost_base_remaining) c FROM crypto_lots
              WHERE bank_account_id = bank GROUP BY 1) l USING (crypto_asset_id)
        WHERE b.bank_account_id = bank AND (b.amount <> l.q OR b.cost_base_remaining <> l.c));
END $$;
ROLLBACK;
