DROP FUNCTION IF EXISTS budgeting.put__lending_take_more_debt;
CREATE FUNCTION budgeting.put__lending_take_more_debt(
    _user_id bigint,
    _position_id bigint,
    _debt_qty numeric,
    _value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _borrowed_crypto_asset_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _borrow_asset_id bigint;
    _borrow_asset record;
    _borrow_position record;
    _target_position_id bigint;
    _base_currency_code char(3);
    _asset_metadata jsonb;
    _current_borrowed numeric(30, 12);
    _new_borrowed numeric(30, 12);
    _existing_value numeric(20, 2);
    _new_value numeric(20, 2);
    _resolved_value numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _debt_qty IS NULL OR _debt_qty <= 0 THEN
        RAISE EXCEPTION 'Debt quantity must be positive';
    END IF;
    _debt_qty := round(_debt_qty, 12);

    SELECT *
    INTO _existing
    FROM crypto_protocol_positions
    WHERE id = _position_id
    FOR UPDATE;

    IF _existing.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto protocol position %', _position_id;
    END IF;

    IF _existing.position_type <> 'lending' THEN
        RAISE EXCEPTION 'Only lending positions can take debt';
    END IF;

    IF _existing.status <> 'open' THEN
        RAISE EXCEPTION 'Closed lending position cannot take more debt';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    _borrow_asset_id := NULLIF((_existing.metadata ->> 'borrowed_crypto_asset_id'), '')::bigint;
    IF _borrow_asset_id IS NULL THEN
        IF _borrowed_crypto_asset_id IS NULL THEN
            RAISE EXCEPTION 'Lending position has no borrowed asset; pass _borrowed_crypto_asset_id';
        END IF;
        _borrow_asset_id := _borrowed_crypto_asset_id;
    ELSIF _borrowed_crypto_asset_id IS NOT NULL AND _borrowed_crypto_asset_id <> _borrow_asset_id THEN
        RAISE EXCEPTION 'Заём по этому лендингу уже идёт в другой монете';
    END IF;

    SELECT *
    INTO _borrow_asset
    FROM crypto_assets
    WHERE id = _borrow_asset_id;

    IF _borrow_asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown borrowed crypto asset %', _borrow_asset_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_existing.owner_type, _existing.owner_user_id, _existing.owner_family_id);

    _asset_metadata := jsonb_build_object(
        'crypto_kind', 'spot',
        'crypto_asset_id', _borrow_asset.id,
        'asset_symbol', _borrow_asset.symbol,
        'asset_name', _borrow_asset.name,
        'network_code', _borrow_asset.network_code,
        'contract_address', _borrow_asset.contract_address
    );

    SELECT *
    INTO _borrow_position
    FROM portfolio_positions
    WHERE investment_account_id = _existing.investment_account_id
      AND asset_type_code = 'crypto'
      AND status = 'open'
      AND COALESCE((metadata ->> 'crypto_asset_id')::bigint, 0) = _borrow_asset.id
    ORDER BY opened_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    _resolved_value := round(COALESCE(_value_in_base, 0), 2);

    IF _borrow_position.id IS NOT NULL THEN
        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _debt_qty,
            amount_in_currency = 0,
            metadata = metadata || _asset_metadata
        WHERE id = _borrow_position.id;
        _target_position_id := _borrow_position.id;

        INSERT INTO portfolio_events (
            position_id, event_type, event_at, quantity, amount, currency_code,
            linked_operation_id, comment, metadata, created_by_user_id
        )
        VALUES (
            _target_position_id,
            'top_up',
            COALESCE(_operated_at, current_date),
            _debt_qty,
            NULL, NULL, NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata || jsonb_build_object(
                'action', 'lending_take_more_debt',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'entry_value_in_base', 0,
                'source_kind', 'lending_borrow',
                'value_in_base', _resolved_value
            ),
            _user_id
        );
    ELSE
        INSERT INTO portfolio_positions (
            owner_type, owner_user_id, owner_family_id, investment_account_id,
            asset_type_code, title, quantity, amount_in_currency, currency_code,
            opened_at, comment, metadata, created_by_user_id
        )
        VALUES (
            _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id,
            _existing.investment_account_id,
            'crypto', _borrow_asset.symbol, _debt_qty, 0, _base_currency_code,
            COALESCE(_operated_at, current_date),
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata,
            _user_id
        )
        RETURNING id INTO _target_position_id;

        INSERT INTO portfolio_events (
            position_id, event_type, event_at, quantity, amount, currency_code,
            linked_operation_id, comment, metadata, created_by_user_id
        )
        VALUES (
            _target_position_id,
            'open',
            COALESCE(_operated_at, current_date),
            _debt_qty,
            NULL, NULL, NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Дополнительный заём (лендинг)'),
            _asset_metadata || jsonb_build_object(
                'action', 'lending_take_more_debt',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'entry_value_in_base', 0,
                'source_kind', 'lending_borrow',
                'value_in_base', _resolved_value
            ),
            _user_id
        );
    END IF;

    _current_borrowed := COALESCE(NULLIF(_existing.metadata ->> 'borrowed_quantity', ''), '0')::numeric;
    _new_borrowed := round(_current_borrowed + _debt_qty, 12);
    _existing_value := COALESCE(NULLIF(_existing.metadata ->> 'borrowed_value_in_base', ''), '0')::numeric;
    _new_value := round(_existing_value + _resolved_value, 2);

    UPDATE crypto_protocol_positions
    SET metadata = metadata || jsonb_build_object(
            'borrowed_crypto_asset_id', _borrow_asset.id,
            'borrowed_asset', _borrow_asset.symbol,
            'borrowed_asset_symbol', _borrow_asset.symbol,
            'borrowed_quantity', _new_borrowed,
            'borrowed_position_id', _target_position_id,
            'borrowed_value_in_base', _new_value
        ),
        updated_at = current_timestamp
    WHERE id = _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
