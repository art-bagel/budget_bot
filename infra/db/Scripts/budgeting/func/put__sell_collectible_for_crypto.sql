-- Sell an item for coins received on the same collection account. The item's
-- cost carries into one new lot of the coin: the result appears when the coins
-- themselves are sold, as a carried exchange.
DROP FUNCTION IF EXISTS budgeting.put__sell_collectible_for_crypto;
CREATE FUNCTION budgeting.put__sell_collectible_for_crypto(
    _user_id bigint,
    _position_id bigint,
    _crypto_asset_id bigint,
    _crypto_quantity numeric,
    _closed_at date,
    _comment text,
    _item_quantity numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _position record;
    _symbol text;
    _base char(3);
    _cost numeric(20, 2);
    _sold_quantity numeric;
    _fraction numeric;
    _operation_id bigint;
    _sold jsonb;
    _day date := COALESCE(_closed_at, current_date);
BEGIN
    SET search_path TO budgeting;
    IF _crypto_quantity IS NULL OR _crypto_quantity <= 0 OR _crypto_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR _crypto_quantity <> round(_crypto_quantity, 18) THEN
        RAISE EXCEPTION 'Количество монет должно быть положительным, до 18 знаков';
    END IF;
    SELECT * INTO _position FROM portfolio_positions WHERE id = _position_id FOR UPDATE;
    IF _position.id IS NULL OR _position.asset_type_code <> 'collectible'
       OR NOT has__owner_access(_user_id, _position.owner_type, _position.owner_user_id, _position.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к предмету';
    END IF;
    IF _day < _position.opened_at THEN RAISE EXCEPTION 'Дата продажи раньше получения предмета'; END IF;
    IF _position.status <> 'open' THEN
        RAISE EXCEPTION 'Предмет уже продан';
    END IF;
    PERFORM 1 FROM bank_accounts WHERE id = _position.investment_account_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for portfolio position %', _position_id;
    END IF;
    SELECT symbol INTO _symbol FROM crypto_assets WHERE id = _crypto_asset_id;
    IF _symbol IS NULL THEN
        RAISE EXCEPTION 'Неизвестная криптовалюта';
    END IF;
    _base := get__owner_base_currency(_position.owner_type, _position.owner_user_id, _position.owner_family_id);
    _sold_quantity := COALESCE(_item_quantity,_position.quantity);
    IF _item_quantity IS NOT NULL AND (_item_quantity<=0 OR _item_quantity::text IN ('NaN','Infinity','-Infinity')
       OR _position.quantity IS NULL OR _item_quantity>_position.quantity OR _item_quantity<>round(_item_quantity,8)) THEN
        RAISE EXCEPTION 'Укажите количество продаваемых предметов в пределах остатка';
    END IF;
    _fraction := CASE WHEN _position.quantity IS NULL THEN 1 ELSE _sold_quantity/_position.quantity END;
    _cost := round(COALESCE((_position.metadata->>'amount_in_base')::numeric, 0)*_fraction,2);
    _sold := jsonb_build_object('crypto_asset_id', _crypto_asset_id, 'symbol', _symbol,
                                'quantity', trim_scale(_crypto_quantity));

    INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment, operated_on)
    VALUES (_user_id, _position.owner_type, _position.owner_user_id, _position.owner_family_id, 'investment_trade',
            concat_ws(' · ', 'Продажа предмета', _position.title, NULLIF(btrim(_comment), '')), _day)
    RETURNING id INTO _operation_id;
    INSERT INTO crypto_lots (bank_account_id, crypto_asset_id, amount_initial, amount_remaining,
                             cost_base_initial, cost_base_remaining, opened_by_operation_id, metadata)
    VALUES (_position.investment_account_id, _crypto_asset_id, _crypto_quantity, _crypto_quantity, _cost, _cost,
            _operation_id, jsonb_build_object('source', 'collectible_sale', 'position_id', _position_id));
    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _position.investment_account_id, _crypto_asset_id, _crypto_quantity);
    PERFORM put__apply_current_crypto_delta(_position.investment_account_id, _crypto_asset_id, _crypto_quantity, _cost);

    UPDATE portfolio_positions
    SET status = CASE WHEN _fraction=1 THEN 'closed' ELSE 'open' END,
        closed_at = CASE WHEN _fraction=1 THEN _day ELSE NULL END,
        close_amount_in_currency = CASE WHEN _fraction=1 THEN _cost ELSE NULL END, close_currency_code = CASE WHEN _fraction=1 THEN _base ELSE NULL END,
        quantity = CASE WHEN _fraction=1 THEN quantity ELSE quantity-_sold_quantity END,
        amount_in_currency = CASE WHEN _fraction=1 THEN amount_in_currency ELSE amount_in_currency*(1-_fraction) END,
        metadata = metadata || jsonb_build_object(
            'realized_result_in_base', COALESCE((metadata->>'realized_result_in_base')::numeric, 0),
            'returned_amount_in_base', COALESCE((metadata->>'returned_amount_in_base')::numeric, 0) + _cost,
            'sold_for_crypto', _sold,
            'amount_in_base', CASE WHEN _fraction=1 THEN (metadata->>'amount_in_base')::numeric ELSE (metadata->>'amount_in_base')::numeric-_cost END)
    WHERE id = _position_id;
    INSERT INTO portfolio_events (position_id, event_type, event_at, quantity, amount, currency_code,
                                  linked_operation_id, comment, metadata, created_by_user_id)
    VALUES (_position_id, CASE WHEN _fraction=1 THEN 'close' ELSE 'partial_close' END, _day, _sold_quantity, _cost, _base, _operation_id, NULLIF(btrim(_comment), ''),
            jsonb_build_object('amount_in_base', _cost, 'principal_amount_in_base', _cost,
                               'realized_result_in_base', 0, 'sold_for_crypto', _sold),
            _user_id);

    RETURN get__portfolio_position(_user_id, _position_id);
END
$function$;
