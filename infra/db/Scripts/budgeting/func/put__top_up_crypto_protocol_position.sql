DROP FUNCTION IF EXISTS budgeting.put__top_up_crypto_protocol_position;
CREATE FUNCTION budgeting.put__top_up_crypto_protocol_position(
    _user_id bigint,
    _position_id bigint,
    _source_position_id bigint,
    _quantity numeric,
    _secondary_source_position_id bigint DEFAULT NULL,
    _secondary_quantity numeric DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _source_position record;
    _secondary_position record;
    _source_quantity numeric(30, 12);
    _remaining_quantity numeric(30, 12);
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
    _secondary_source_quantity numeric(30, 12);
    _secondary_remaining_quantity numeric(30, 12);
    _secondary_entry_summary jsonb;
    _secondary_remaining_basis numeric(20, 2);
    _secondary_consumed_cost_basis numeric(20, 2);
    _secondary_asset_symbol text;
    _new_token1_quantity numeric(30, 12);
    _added_basis numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    SELECT *
    INTO _existing
    FROM crypto_protocol_positions
    WHERE id = _position_id
    FOR UPDATE;

    IF _existing.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto protocol position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    IF _existing.status <> 'open' THEN
        RAISE EXCEPTION 'Closed protocol position cannot be topped up';
    END IF;

    IF _quantity IS NULL OR _quantity <= 0 THEN
        RAISE EXCEPTION 'Top-up quantity must be positive';
    END IF;

    IF _secondary_source_position_id IS NOT NULL AND _existing.position_type <> 'liquidity_pool' THEN
        RAISE EXCEPTION 'Secondary source is only allowed for liquidity_pool positions';
    END IF;

    IF _secondary_source_position_id IS NOT NULL AND _secondary_source_position_id = _source_position_id THEN
        RAISE EXCEPTION 'Token B must differ from token A';
    END IF;

    -- Token A.
    SELECT *
    INTO _source_position
    FROM portfolio_positions
    WHERE id = _source_position_id
      AND status = 'open'
    FOR UPDATE;

    IF _source_position.id IS NULL THEN
        RAISE EXCEPTION 'Unknown open crypto asset position %', _source_position_id;
    END IF;

    IF _source_position.investment_account_id <> _existing.investment_account_id
       OR _source_position.asset_type_code <> 'crypto' THEN
        RAISE EXCEPTION 'Source position must be an open crypto asset on the same account';
    END IF;

    _quantity := round(_quantity, 12);
    _source_quantity := COALESCE(_source_position.quantity, 0);

    IF _source_quantity < _quantity THEN
        RAISE EXCEPTION 'Сумма превышает остаток (token A)';
    END IF;

    _remaining_quantity := round(_source_quantity - _quantity, 12);

    _entry_summary := budgeting.get__crypto_position_entry_summary(_source_position_id);
    _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
    _consumed_cost_basis := CASE
        WHEN _source_quantity > 0
            THEN round(_remaining_basis * _quantity / _source_quantity, 2)
        ELSE 0
    END;

    IF _remaining_quantity <= 0 THEN
        UPDATE portfolio_positions
        SET status = 'closed',
            quantity = 0,
            closed_at = COALESCE(_operated_at, current_date),
            close_amount_in_currency = 0,
            close_currency_code = currency_code
        WHERE id = _source_position_id;
    ELSE
        UPDATE portfolio_positions
        SET quantity = _remaining_quantity,
            amount_in_currency = 0
        WHERE id = _source_position_id;
    END IF;

    INSERT INTO portfolio_events (
        position_id, event_type, event_at, quantity, amount, currency_code,
        linked_operation_id, comment, metadata, created_by_user_id
    )
    VALUES (
        _source_position_id,
        'transfer_out',
        COALESCE(_operated_at, current_date),
        _quantity,
        NULL, NULL, NULL,
        COALESCE(NULLIF(btrim(_comment), ''), 'Добор в DeFi-протокол'),
        jsonb_build_object(
            'action', 'top_up_protocol',
            'protocol_position_id', _position_id,
            'protocol_name', _existing.protocol_name,
            'position_type', _existing.position_type,
            'protocol_quantity', _quantity,
            'value_in_base', _consumed_cost_basis,
            'consumed_cost_basis', _consumed_cost_basis,
            'token_role', 'token_a'
        ),
        _user_id
    );

    _added_basis := _consumed_cost_basis;

    -- Token B (LP only).
    IF _secondary_source_position_id IS NOT NULL THEN
        IF _secondary_quantity IS NULL OR _secondary_quantity <= 0 THEN
            RAISE EXCEPTION 'Token B quantity must be positive';
        END IF;

        SELECT *
        INTO _secondary_position
        FROM portfolio_positions
        WHERE id = _secondary_source_position_id
          AND status = 'open'
        FOR UPDATE;

        IF _secondary_position.id IS NULL THEN
            RAISE EXCEPTION 'Unknown open crypto asset position %', _secondary_source_position_id;
        END IF;

        IF _secondary_position.investment_account_id <> _existing.investment_account_id
           OR _secondary_position.asset_type_code <> 'crypto' THEN
            RAISE EXCEPTION 'Secondary source position must be an open crypto asset on the same account';
        END IF;

        _secondary_quantity := round(_secondary_quantity, 12);
        _secondary_source_quantity := COALESCE(_secondary_position.quantity, 0);

        IF _secondary_source_quantity < _secondary_quantity THEN
            RAISE EXCEPTION 'Сумма превышает остаток (token B)';
        END IF;

        _secondary_remaining_quantity := round(_secondary_source_quantity - _secondary_quantity, 12);

        _secondary_entry_summary := budgeting.get__crypto_position_entry_summary(_secondary_source_position_id);
        _secondary_remaining_basis := COALESCE((_secondary_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
        _secondary_consumed_cost_basis := CASE
            WHEN _secondary_source_quantity > 0
                THEN round(_secondary_remaining_basis * _secondary_quantity / _secondary_source_quantity, 2)
            ELSE 0
        END;

        _secondary_asset_symbol := COALESCE(
            NULLIF(btrim(_secondary_position.metadata ->> 'asset_symbol'), ''),
            NULLIF(btrim(_secondary_position.title), '')
        );

        IF _secondary_remaining_quantity <= 0 THEN
            UPDATE portfolio_positions
            SET status = 'closed',
                quantity = 0,
                closed_at = COALESCE(_operated_at, current_date),
                close_amount_in_currency = 0,
                close_currency_code = currency_code
            WHERE id = _secondary_source_position_id;
        ELSE
            UPDATE portfolio_positions
            SET quantity = _secondary_remaining_quantity,
                amount_in_currency = 0
            WHERE id = _secondary_source_position_id;
        END IF;

        INSERT INTO portfolio_events (
            position_id, event_type, event_at, quantity, amount, currency_code,
            linked_operation_id, comment, metadata, created_by_user_id
        )
        VALUES (
            _secondary_source_position_id,
            'transfer_out',
            COALESCE(_operated_at, current_date),
            _secondary_quantity,
            NULL, NULL, NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Добор в DeFi-протокол'),
            jsonb_build_object(
                'action', 'top_up_protocol',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'position_type', _existing.position_type,
                'protocol_asset_symbol', _secondary_asset_symbol,
                'protocol_quantity', _secondary_quantity,
                'value_in_base', _secondary_consumed_cost_basis,
                'consumed_cost_basis', _secondary_consumed_cost_basis,
                'token_role', 'token_b'
            ),
            _user_id
        );

        _added_basis := _added_basis + _secondary_consumed_cost_basis;
        _new_token1_quantity := COALESCE((_existing.metadata ->> 'token1_quantity')::numeric, 0) + _secondary_quantity;
    END IF;

    IF _secondary_source_position_id IS NOT NULL THEN
        UPDATE crypto_protocol_positions
        SET quantity = COALESCE(quantity, 0) + _quantity,
            current_quantity = COALESCE(current_quantity, 0) + _quantity,
            cost_basis_in_base = COALESCE(cost_basis_in_base, 0) + _added_basis,
            current_value_in_base = COALESCE(current_value_in_base, 0) + _added_basis,
            comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
            metadata = metadata || jsonb_build_object(
                'token1_quantity', _new_token1_quantity,
                'token1_crypto_asset_id', COALESCE(
                    (metadata ->> 'token1_crypto_asset_id')::bigint,
                    (_secondary_position.metadata ->> 'crypto_asset_id')::bigint
                ),
                'token1_cost_basis_carried', COALESCE((metadata ->> 'token1_cost_basis_carried')::numeric, 0) + _secondary_consumed_cost_basis
            ),
            updated_at = current_timestamp
        WHERE id = _position_id;
    ELSE
        UPDATE crypto_protocol_positions
        SET quantity = COALESCE(quantity, 0) + _quantity,
            current_quantity = COALESCE(current_quantity, 0) + _quantity,
            cost_basis_in_base = COALESCE(cost_basis_in_base, 0) + _added_basis,
            current_value_in_base = COALESCE(current_value_in_base, 0) + _added_basis,
            comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
            updated_at = current_timestamp
        WHERE id = _position_id;
    END IF;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
