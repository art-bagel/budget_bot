-- Coins on a collection account live like bank coins: they arrive from a crypto
-- account and leave to one through the journal without budget entries, pay for
-- items and come back from item sales with the cost carried. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000902;
    me jsonb; bank bigint; free bigint; wallet bigint; coll bigint; misc bigint; coin bigint;
    pos bigint; item jsonb; sold jsonb; r jsonb; err text; free_before numeric; op bigint;
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Coins', 'Owner');
    bank := (me->>'bank_account_id')::bigint;
    free := (me->>'unallocated_category_id')::bigint;
    wallet := (put__create_bank_account(uid, 'Кошелёк', 'user', 'investment', 'crypto')->>'id')::bigint;
    coll := (put__create_bank_account(uid, 'Коллекции', 'user', 'investment', 'collectible')->>'id')::bigint;
    misc := (put__create_bank_account(uid, 'Разное', 'user', 'investment', 'other')->>'id')::bigint;
    coin := (put__ensure_crypto_asset('TGRAM', 'Collection coin', 'ton', '0:collection-coin', 9::smallint, '{}'::jsonb)->>'id')::bigint;

    PERFORM put__record_income(uid, bank, 50000, 'RUB');
    PERFORM put__buy_crypto_asset(uid, bank, 'RUB', 10000, coin, 100);   -- 100 per coin
    PERFORM put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_to_portfolio', jsonb_build_object(
        'bank_account_id', bank, 'investment_account_id', wallet, 'crypto_asset_id', coin, 'amount', '100'));
    pos := (SELECT id FROM portfolio_positions WHERE investment_account_id = wallet AND status = 'open');
    free_before := (SELECT amount FROM current_budget_balances WHERE category_id = free);

    -- 1. Crypto account -> collection account: coins arrive at cost, the budget is untouched.
    r := put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_withdraw', jsonb_build_object(
        'position_id', pos, 'bank_account_id', coll, 'amount', '60'));
    op := (r->>'operation_id')::bigint;
    ASSERT (SELECT (amount, cost_base_remaining) = (60::numeric, 6000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection holds 60 at 6000';
    ASSERT NOT EXISTS (SELECT 1 FROM budget_entries WHERE operation_id = op), 'no budget entries for the move';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = free_before, 'free budget unchanged';
    ASSERT (SELECT quantity FROM portfolio_positions WHERE id = pos) = 40, 'wallet keeps 40';

    -- 2. Buy an item with 25 coins: the coins' FIFO cost becomes the item's cost.
    item := put__buy_collectible_with_crypto(uid, coll, coin, 25, 'Plush Pepe #7', 1, current_date, NULL,
        '{"item_kind": "telegram_gift", "item_attributes": {"number": "7"}, "amount_in_base": 1}');
    ASSERT (item->>'amount_in_currency')::numeric = 2500 AND (item->'metadata'->>'amount_in_base')::numeric = 2500,
        format('item cost 2500, got %s', item);
    ASSERT item->'metadata'->'paid_crypto'->>'quantity' = '25', 'paid coins recorded';
    ASSERT (SELECT (amount, cost_base_remaining) = (35::numeric, 3500::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection coins 35 at 3500';

    -- 3. Not more coins than the account holds.
    err := '';
    BEGIN
        PERFORM put__buy_collectible_with_crypto(uid, coll, coin, 36, 'Too much', 1, current_date, NULL, '{"item_kind": "other"}');
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE 'Сумма превышает остаток%', format('overspend rejected, got "%s"', err);

    -- 4. Sell the item for 30 coins: the item's cost carries into the new lot, no result.
    sold := put__sell_collectible_for_crypto(uid, (item->>'id')::bigint, coin, 30, current_date, NULL);
    ASSERT sold->>'status' = 'closed' AND (sold->'metadata'->>'realized_result_in_base')::numeric = 0, 'sold at carried cost';
    ASSERT sold->'metadata'->'sold_for_crypto'->>'quantity' = '30', 'received coins recorded';
    ASSERT (SELECT (amount, cost_base_remaining) = (65::numeric, 6000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection coins 65 at 6000';

    -- 5. Collection account -> crypto account through the journal, no budget entries.
    r := put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_to_portfolio', jsonb_build_object(
        'bank_account_id', coll, 'investment_account_id', wallet, 'crypto_asset_id', coin, 'amount', '65'));
    op := (r->>'operation_id')::bigint;
    ASSERT NOT EXISTS (SELECT 1 FROM budget_entries WHERE operation_id = op), 'no budget entries for the way back';
    ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id = coll AND crypto_asset_id = coin), 0) = 0,
        'collection coins moved out';
    ASSERT (SELECT quantity FROM portfolio_positions WHERE id = pos) = 105, 'wallet 40 + 65';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = free_before, 'free budget still unchanged';

    -- 6. Only collection accounts hold coins outside the bank.
    err := '';
    BEGIN
        PERFORM put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_withdraw', jsonb_build_object(
            'position_id', pos, 'bank_account_id', misc, 'amount', '1'));
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE 'Target account must be a cash or collection account%', format('other account rejected, got "%s"', err);
    err := '';
    BEGIN
        PERFORM put__buy_collectible_with_crypto(uid, misc, coin, 1, 'Wrong', 1, current_date, NULL, '{"item_kind": "other"}');
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err = 'Нет доступа к счёту коллекций', format('item only on collections, got "%s"', err);

    -- 7. Lots equal the projection.
    ASSERT NOT EXISTS (
        SELECT 1 FROM current_crypto_balances b
        JOIN LATERAL (SELECT sum(amount_remaining) q, sum(cost_base_remaining) c FROM crypto_lots l
                      WHERE l.bank_account_id = b.bank_account_id AND l.crypto_asset_id = b.crypto_asset_id) l ON true
        WHERE b.bank_account_id IN (bank, coll) AND (b.amount, b.cost_base_remaining) IS DISTINCT FROM (l.q, l.c)
    ), 'lots match balances';
END $$;
ROLLBACK;
