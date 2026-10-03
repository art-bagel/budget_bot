-- Collections: an investment account of type 'collectible' holds items bought
-- and sold for its money. Item metadata is whitelisted; accounting values in
-- caller metadata are ignored for every position type. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000901;
    me jsonb; bank bigint; coll bigint; misc bigint; pos jsonb; closed jsonb; err text;
    bad jsonb; expected text;
    attrs jsonb := '{"collection": "Plush Pepe", "number": "1"}';
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Items', 'Owner');
    bank := (me->>'bank_account_id')::bigint;
    coll := (put__create_bank_account(uid, 'Коллекции', 'user', 'investment', 'collectible')->>'id')::bigint;
    misc := (put__create_bank_account(uid, 'Разное', 'user', 'investment', 'other')->>'id')::bigint;
    PERFORM put__record_income(uid, bank, 50000, 'RUB');
    PERFORM put__transfer_between_accounts(uid, bank, coll, 'RUB', 20000);
    PERFORM put__transfer_between_accounts(uid, bank, misc, 'RUB', 5000);

    -- 1. Buying an item: cost comes from the account's money, metadata is whitelisted.
    pos := put__create_portfolio_position(uid, coll, 'collectible', 'Plush Pepe #1', 1, 12000, 'RUB', current_date, NULL,
        jsonb_build_object('item_kind', 'telegram_gift', 'item_link', 'https://t.me/nft/PlushPepe-1',
            'item_attributes', attrs, 'amount_in_base', 1, 'realized_result_in_base', 999, 'foo', 'bar'));
    ASSERT (pos->'metadata'->>'amount_in_base')::numeric = 12000, format('cost 12000, got %s', pos->'metadata');
    ASSERT pos->'metadata'->>'item_kind' = 'telegram_gift' AND pos->'metadata'->'item_attributes' = attrs
        AND pos->'metadata'->>'item_link' = 'https://t.me/nft/PlushPepe-1', 'item fields kept';
    ASSERT NOT (pos->'metadata' ?| ARRAY['foo', 'realized_result_in_base']), 'unknown and accounting keys dropped';
    ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id = coll AND currency_code = 'RUB') = 8000,
        'account paid 12000';

    -- 2. Selling: proceeds return to the account, result = proceeds - cost.
    closed := put__close_portfolio_position(uid, (pos->>'id')::bigint, 15000, 'RUB');
    ASSERT closed->>'status' = 'closed', 'item sold';
    ASSERT (closed->'metadata'->>'realized_result_in_base')::numeric = 3000,
        format('result 3000, got %s', closed->'metadata'->>'realized_result_in_base');
    ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id = coll AND currency_code = 'RUB') = 23000,
        'proceeds on the account';

    -- 3. Kind is required, the link must be https, attributes are short text.
    FOR bad, expected IN VALUES
        ('{}'::jsonb, 'Укажите вид предмета%'),
        ('{"item_kind": "car"}', 'Укажите вид предмета%'),
        ('{"item_kind": "sticker", "item_link": "javascript:alert(1)"}', 'Ссылка на предмет%'),
        ('{"item_kind": "sticker", "item_link": "https://a b"}', 'Ссылка на предмет%'),
        ('{"item_kind": "sticker", "item_attributes": {"number": 1}}', 'Параметры предмета%'),
        ('{"item_kind": "sticker", "item_attributes": ["x"]}', 'Параметры предмета%'),
        (jsonb_build_object('item_kind', 'sticker', 'item_attributes', jsonb_build_object('note', repeat('x', 201))),
            'Параметры предмета%')
    LOOP
        err := '';
        BEGIN
            PERFORM put__create_portfolio_position(uid, coll, 'collectible', 'Bad', 1, 100, 'RUB', current_date, NULL, bad);
        EXCEPTION WHEN raise_exception THEN err := SQLERRM;
        END;
        ASSERT err LIKE expected, format('%s -> expected "%s", got "%s"', bad, expected, err);
    END LOOP;

    -- 4. Items live only on collection accounts.
    err := '';
    BEGIN
        PERFORM put__create_portfolio_position(uid, misc, 'collectible', 'Gift', 1, 100, 'RUB', current_date, NULL,
            '{"item_kind": "other"}');
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE 'Investment account asset type mismatch%', format('mismatch, got "%s"', err);

    -- 5. Other position types also ignore caller accounting values but keep their own fields.
    pos := put__create_portfolio_position(uid, misc, 'other', 'Gold', NULL, 3000, 'RUB', current_date, NULL,
        '{"amount_in_base": 1, "income_in_base": 500, "note": "bar"}');
    ASSERT (pos->'metadata'->>'amount_in_base')::numeric = 3000, 'ledger cost wins';
    ASSERT NOT (pos->'metadata' ? 'income_in_base') AND pos->'metadata'->>'note' = 'bar', 'income dropped, note kept';

    -- 6. History can be filtered by the new account type.
    ASSERT jsonb_array_length(get__operations_history(uid, 50, 0, NULL, 'collectible')->'items') >= 2,
        'collection operations in history';
END $$;
ROLLBACK;
