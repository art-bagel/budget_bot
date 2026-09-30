-- Buy an item with coins held on the same collection account. The FIFO cost of
-- the coins becomes the item's cost: no sale, income or result, as a carried
-- exchange. Units already spent outside the bot cannot pay for an item.
DROP FUNCTION IF EXISTS budgeting.put__buy_collectible_with_crypto;
CREATE FUNCTION budgeting.put__buy_collectible_with_crypto(
    _user_id bigint,
    _investment_account_id bigint,
    _crypto_asset_id bigint,
    _crypto_quantity numeric,
    _title text,
    _quantity numeric,
    _opened_at date,
    _comment text,
    _metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account record;
    _symbol text;
    _base char(3);
    _need numeric(50, 18);
    _take numeric(50, 18);
    _take_cost numeric(20, 2);
    _cost numeric(20, 2) := 0;
    _lot record;
    _operation_id bigint;
    _position_id bigint;
    _day date := COALESCE(_opened_at, current_date);
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(btrim(_title), '') IS NULL THEN
        RAISE EXCEPTION 'Укажите название предмета';
    END IF;
    IF _crypto_quantity IS NULL OR _crypto_quantity <= 0 OR _crypto_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR _crypto_quantity <> round(_crypto_quantity, 18) THEN
        RAISE EXCEPTION 'Количество монет должно быть положительным, до 18 знаков';
    END IF;
    IF _quantity IS NOT NULL AND _quantity <= 0 THEN
        RAISE EXCEPTION 'Position quantity must be positive when provided';
    END IF;
    _metadata := calc__collectible_metadata(_metadata);

    SELECT * INTO _account FROM bank_accounts WHERE id = _investment_account_id AND is_active FOR UPDATE;
    IF _account.id IS NULL OR _account.account_kind <> 'investment' OR _account.investment_asset_type <> 'collectible'
       OR NOT has__owner_access(_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к счёту коллекций';
    END IF;
    SELECT symbol INTO _symbol FROM crypto_assets WHERE id = _crypto_asset_id;
    IF _symbol IS NULL THEN
        RAISE EXCEPTION 'Неизвестная криптовалюта';
    END IF;
    _base := get__owner_base_currency(_account.owner_type, _account.owner_user_id, _account.owner_family_id);

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on)
    VALUES (_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id, 'investment_trade',
            concat_ws(' · ', 'Покупка предмета', btrim(_title), NULLIF(btrim(_comment), '')), _day)
    RETURNING id INTO _operation_id;

    _need := _crypto_quantity;
    FOR _lot IN
        SELECT id, amount_remaining, cost_base_remaining
        FROM crypto_lots
        WHERE bank_account_id = _investment_account_id
          AND crypto_asset_id = _crypto_asset_id
          AND amount_remaining > 0
          AND NOT COALESCE((metadata->>'reserved_for_manual_expense')::boolean, false)
        ORDER BY created_at, id
        FOR UPDATE
    LOOP
        EXIT WHEN _need <= 0;
        _take := LEAST(_need, _lot.amount_remaining);
        _take_cost := CASE WHEN _take = _lot.amount_remaining THEN _lot.cost_base_remaining
                           ELSE round(_lot.cost_base_remaining * _take / _lot.amount_remaining, 2) END;
        UPDATE crypto_lots
        SET amount_remaining = amount_remaining - _take,
            cost_base_remaining = cost_base_remaining - _take_cost
        WHERE id = _lot.id;
        INSERT INTO crypto_lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _lot.id, _take, _take_cost);
        _cost := _cost + _take_cost;
        _need := _need - _take;
    END LOOP;
    IF _need > 0 THEN
        RAISE EXCEPTION 'Сумма превышает остаток %', _symbol;
    END IF;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _investment_account_id, _crypto_asset_id, -_crypto_quantity);
    PERFORM put__apply_current_crypto_delta(_investment_account_id, _crypto_asset_id, -_crypto_quantity, -_cost);

    _metadata := _metadata || jsonb_build_object(
        'amount_in_base', _cost,
        'paid_crypto', jsonb_build_object('crypto_asset_id', _crypto_asset_id, 'symbol', _symbol,
                                          'quantity', trim_scale(_crypto_quantity))
    );
    INSERT INTO portfolio_positions (owner_type, owner_user_id, owner_family_id, investment_account_id, asset_type_code,
                                     title, quantity, amount_in_currency, currency_code, opened_at, comment, metadata,
                                     created_by_user_id)
    VALUES (_account.owner_type, _account.owner_user_id, _account.owner_family_id, _investment_account_id, 'collectible',
            btrim(_title), _quantity, _cost, _base, _day, NULLIF(btrim(_comment), ''), _metadata, _user_id)
    RETURNING id INTO _position_id;
    INSERT INTO portfolio_events (position_id, event_type, event_at, quantity, amount, currency_code,
                                  linked_operation_id, comment, metadata, created_by_user_id)
    VALUES (_position_id, 'open', _day, _quantity, _cost, _base, _operation_id, NULLIF(btrim(_comment), ''),
            _metadata, _user_id);

    RETURN get__portfolio_position(_user_id, _position_id);
END
$function$;
