DROP FUNCTION IF EXISTS budgeting.set__close_crypto_protocol_position;
CREATE FUNCTION budgeting.set__close_crypto_protocol_position(
    _user_id bigint,
    _position_id bigint,
    _withdrawn_at date DEFAULT NULL,
    _current_quantity numeric DEFAULT NULL,
    _current_value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _return_quantity numeric DEFAULT NULL,
    _return_value_in_base numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _asset record;
    _target_position_id bigint;
    _resolved_return_quantity numeric(30, 12);
    _base_currency_code char(3);
    _asset_symbol text;
    _asset_name text;
    _asset_network_code text;
    _asset_contract_address text;
    _original_quantity numeric(30, 12);
    _carried_cost numeric(20, 2);
    _principal_qty numeric(30, 12);
    _rewards_qty numeric(30, 12);
    _principal_entry_value numeric(20, 2);
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

    _resolved_return_quantity := round(COALESCE(_return_quantity, _current_quantity, _existing.current_quantity, 0), 12);
    _base_currency_code := budgeting.get__owner_base_currency(_existing.owner_type, _existing.owner_user_id, _existing.owner_family_id);

    UPDATE crypto_protocol_positions
    SET status = 'closed',
        withdrawn_at = COALESCE(_withdrawn_at, current_date),
        current_quantity = COALESCE(_current_quantity, current_quantity),
        current_value_in_base = COALESCE(_current_value_in_base, current_value_in_base),
        comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
        metadata = metadata || jsonb_build_object(
            'return_quantity', _resolved_return_quantity
        ),
        updated_at = current_timestamp
    WHERE id = _position_id;

    IF _resolved_return_quantity > 0 THEN
        IF _existing.crypto_asset_id IS NOT NULL THEN
            SELECT *
            INTO _asset
            FROM crypto_assets
            WHERE id = _existing.crypto_asset_id;

            IF _asset.id IS NOT NULL THEN
                _asset_symbol := _asset.symbol;
                _asset_name := _asset.name;
                _asset_network_code := COALESCE(_existing.network_code, _asset.network_code);
                _asset_contract_address := _asset.contract_address;
            END IF;
        END IF;

        _asset_symbol := COALESCE(_asset_symbol, _existing.asset_symbol);
        _asset_name := COALESCE(_asset_name, _existing.asset_symbol);
        _asset_network_code := COALESCE(_asset_network_code, _existing.network_code);

        -- Split returned quantity into principal (carries cost basis) and rewards (zero cost).
        _original_quantity := COALESCE(_existing.quantity, 0);
        _carried_cost := COALESCE(_existing.cost_basis_in_base, 0);
        _principal_qty := LEAST(_resolved_return_quantity, _original_quantity);
        _rewards_qty := GREATEST(_resolved_return_quantity - _original_quantity, 0);
        _principal_entry_value := CASE
            WHEN _original_quantity > 0
                THEN round(_carried_cost * _principal_qty / _original_quantity, 2)
            ELSE 0
        END;

        SELECT id
        INTO _target_position_id
        FROM portfolio_positions
        WHERE investment_account_id = _existing.investment_account_id
          AND status = 'open'
          AND asset_type_code = 'crypto'
          AND COALESCE((metadata ->> 'crypto_asset_id')::bigint, 0) = COALESCE(_existing.crypto_asset_id, 0)
        ORDER BY id
        LIMIT 1
        FOR UPDATE;

        IF _target_position_id IS NULL THEN
            INSERT INTO portfolio_positions (
                owner_type,
                owner_user_id,
                owner_family_id,
                investment_account_id,
                asset_type_code,
                title,
                quantity,
                amount_in_currency,
                currency_code,
                opened_at,
                comment,
                metadata,
                created_by_user_id
            )
            VALUES (
                _existing.owner_type,
                _existing.owner_user_id,
                _existing.owner_family_id,
                _existing.investment_account_id,
                'crypto',
                _asset_symbol,
                _resolved_return_quantity,
                0,
                _base_currency_code,
                COALESCE(_withdrawn_at, current_date),
                COALESCE(NULLIF(btrim(_comment), ''), 'Возврат из DeFi-протокола'),
                jsonb_build_object(
                    'crypto_kind', 'spot',
                    'crypto_asset_id', _existing.crypto_asset_id,
                    'asset_symbol', _asset_symbol,
                    'asset_name', _asset_name,
                    'network_code', _asset_network_code,
                    'contract_address', _asset_contract_address
                ),
                _user_id
            )
            RETURNING id INTO _target_position_id;

            -- Principal return: 'open' (new position) carries cost basis from DeFi.
            INSERT INTO portfolio_events (
                position_id,
                event_type,
                event_at,
                quantity,
                amount,
                currency_code,
                linked_operation_id,
                comment,
                metadata,
                created_by_user_id
            )
            VALUES (
                _target_position_id,
                'open',
                COALESCE(_withdrawn_at, current_date),
                _principal_qty,
                NULL,
                NULL,
                NULL,
                COALESCE(NULLIF(btrim(_comment), ''), 'Возврат принципала из DeFi'),
                jsonb_build_object(
                    'action', 'return_from_protocol',
                    'protocol_position_id', _position_id,
                    'protocol_name', _existing.protocol_name,
                    'entry_value_in_base', _principal_entry_value,
                    'source_kind', 'defi_return',
                    'source_protocol_position_id', _position_id
                ),
                _user_id
            );
        ELSE
            UPDATE portfolio_positions
            SET quantity = COALESCE(quantity, 0) + _resolved_return_quantity,
                amount_in_currency = 0
            WHERE id = _target_position_id;

            -- Principal return: 'top_up' on existing position.
            INSERT INTO portfolio_events (
                position_id,
                event_type,
                event_at,
                quantity,
                amount,
                currency_code,
                linked_operation_id,
                comment,
                metadata,
                created_by_user_id
            )
            VALUES (
                _target_position_id,
                'top_up',
                COALESCE(_withdrawn_at, current_date),
                _principal_qty,
                NULL,
                NULL,
                NULL,
                COALESCE(NULLIF(btrim(_comment), ''), 'Возврат принципала из DeFi'),
                jsonb_build_object(
                    'action', 'return_from_protocol',
                    'protocol_position_id', _position_id,
                    'protocol_name', _existing.protocol_name,
                    'entry_value_in_base', _principal_entry_value,
                    'source_kind', 'defi_return',
                    'source_protocol_position_id', _position_id
                ),
                _user_id
            );
        END IF;

        -- Rewards (if returned > original): separate 'income' event with zero cost.
        IF _rewards_qty > 0 THEN
            INSERT INTO portfolio_events (
                position_id,
                event_type,
                event_at,
                quantity,
                amount,
                currency_code,
                linked_operation_id,
                comment,
                metadata,
                created_by_user_id
            )
            VALUES (
                _target_position_id,
                'income',
                COALESCE(_withdrawn_at, current_date),
                _rewards_qty,
                NULL,
                NULL,
                NULL,
                'Награды из DeFi-протокола',
                jsonb_build_object(
                    'action', 'rewards_from_protocol',
                    'protocol_position_id', _position_id,
                    'protocol_name', _existing.protocol_name,
                    'entry_value_in_base', 0,
                    'source_kind', 'income',
                    'income_kind', 'defi_rewards',
                    'source_protocol_position_id', _position_id
                ),
                _user_id
            );
        END IF;

        UPDATE crypto_protocol_positions
        SET metadata = metadata || jsonb_build_object(
            'return_position_id', _target_position_id,
            'returned_principal_qty', _principal_qty,
            'returned_rewards_qty', _rewards_qty,
            'returned_principal_value_in_base', _principal_entry_value
        )
        WHERE id = _position_id;
    END IF;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
