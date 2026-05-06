DROP FUNCTION IF EXISTS budgeting.put__partial_close_crypto_protocol_position;
CREATE FUNCTION budgeting.put__partial_close_crypto_protocol_position(
    _user_id bigint,
    _position_id bigint,
    _principal_qty numeric DEFAULT 0,
    _rewards_qty numeric DEFAULT 0,
    _principal_value_in_base numeric DEFAULT NULL,
    _rewards_value_in_base numeric DEFAULT NULL,
    _returned_at date DEFAULT NULL,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
    _asset record;
    _target_position_id bigint;
    _base_currency_code char(3);
    _asset_symbol text;
    _asset_name text;
    _asset_network_code text;
    _asset_contract_address text;
    _principal_qty_in numeric(30, 12);
    _rewards_qty_in numeric(30, 12);
    _total_return_qty numeric(30, 12);
    _principal_value numeric(20, 2);
    _rewards_value numeric(20, 2);
    _principal_remaining numeric(30, 12);
    _new_quantity numeric(30, 12);
    _new_cost_basis numeric(20, 2);
    _new_current_quantity numeric(30, 12);
    _new_current_value numeric(20, 2);
    _new_rewards_claimed numeric(20, 2);
    _new_rewards_unclaimed numeric(20, 2);
    _consumed_unclaimed numeric(20, 2);
    _principal_event_type text;
    _operated_on date;
    _comment_clean text;
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
        RAISE EXCEPTION 'Closed protocol position cannot be partially closed';
    END IF;

    _principal_qty_in := round(COALESCE(_principal_qty, 0), 12);
    _rewards_qty_in := round(COALESCE(_rewards_qty, 0), 12);

    IF _principal_qty_in < 0 OR _rewards_qty_in < 0 THEN
        RAISE EXCEPTION 'Principal and rewards quantities must be non-negative';
    END IF;

    IF _principal_qty_in = 0 AND _rewards_qty_in = 0 THEN
        RAISE EXCEPTION 'At least one of principal or rewards quantity must be positive';
    END IF;

    -- Cap principal at the remaining initial principal in the position (`quantity`).
    IF _principal_qty_in > COALESCE(_existing.quantity, 0) THEN
        RAISE EXCEPTION 'Principal qty % exceeds remaining principal %',
            _principal_qty_in, COALESCE(_existing.quantity, 0);
    END IF;

    _total_return_qty := _principal_qty_in + _rewards_qty_in;

    -- Cap total against current_quantity (what's actually in the position now).
    IF _total_return_qty > COALESCE(_existing.current_quantity, 0) THEN
        RAISE EXCEPTION 'Withdrawal qty % exceeds current_quantity %',
            _total_return_qty, COALESCE(_existing.current_quantity, 0);
    END IF;

    -- Resolve value_in_base for principal/rewards. If user did not provide,
    -- split current_value_in_base proportionally by quantity.
    IF _principal_value_in_base IS NULL AND _rewards_value_in_base IS NULL THEN
        IF COALESCE(_existing.current_quantity, 0) > 0 AND COALESCE(_existing.current_value_in_base, 0) > 0 THEN
            _principal_value := round(
                _existing.current_value_in_base * _principal_qty_in / _existing.current_quantity, 2);
            _rewards_value := round(
                _existing.current_value_in_base * _rewards_qty_in / _existing.current_quantity, 2);
        ELSE
            _principal_value := 0;
            _rewards_value := 0;
        END IF;
    ELSE
        _principal_value := round(COALESCE(_principal_value_in_base, 0), 2);
        _rewards_value := round(COALESCE(_rewards_value_in_base, 0), 2);
    END IF;

    IF _principal_qty_in > 0 AND _principal_value < 0 THEN
        RAISE EXCEPTION 'Principal value_in_base must be non-negative';
    END IF;
    IF _rewards_qty_in > 0 AND _rewards_value < 0 THEN
        RAISE EXCEPTION 'Rewards value_in_base must be non-negative';
    END IF;

    -- Compute new DeFi-position state.
    _new_quantity := COALESCE(_existing.quantity, 0) - _principal_qty_in;

    -- Cost basis carried by the principal portion (proportional carve-out).
    IF COALESCE(_existing.quantity, 0) > 0 THEN
        _new_cost_basis := round(
            _existing.cost_basis_in_base
            * _new_quantity
            / _existing.quantity, 2);
    ELSE
        _new_cost_basis := _existing.cost_basis_in_base;
    END IF;

    _new_current_quantity := COALESCE(_existing.current_quantity, 0) - _total_return_qty;
    _new_current_value := GREATEST(
        0,
        round(COALESCE(_existing.current_value_in_base, 0) - _principal_value - _rewards_value, 2));

    -- Rewards bookkeeping: claimed grows by what was actually withdrawn.
    -- Unclaimed shrinks by the same amount, never below zero.
    _consumed_unclaimed := LEAST(_rewards_value, COALESCE(_existing.rewards_unclaimed_in_base, 0));
    _new_rewards_claimed := COALESCE(_existing.rewards_claimed_in_base, 0) + _rewards_value;
    _new_rewards_unclaimed := COALESCE(_existing.rewards_unclaimed_in_base, 0) - _consumed_unclaimed;

    UPDATE crypto_protocol_positions
    SET quantity = _new_quantity,
        cost_basis_in_base = _new_cost_basis,
        current_quantity = _new_current_quantity,
        current_value_in_base = _new_current_value,
        rewards_claimed_in_base = _new_rewards_claimed,
        rewards_unclaimed_in_base = _new_rewards_unclaimed,
        comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
        updated_at = current_timestamp
    WHERE id = _position_id;

    -- Resolve symbol/name for portfolio position.
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

    _base_currency_code := budgeting.get__owner_base_currency(_existing.owner_type, _existing.owner_user_id, _existing.owner_family_id);
    _operated_on := COALESCE(_returned_at, current_date);
    _comment_clean := NULLIF(btrim(_comment), '');

    -- Find or create the portfolio position to land returns into.
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
            _total_return_qty,
            0,
            _base_currency_code,
            _operated_on,
            COALESCE(_comment_clean, 'Частичный возврат из DeFi-протокола'),
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
        _principal_event_type := 'open';
    ELSE
        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _total_return_qty,
            amount_in_currency = 0
        WHERE id = _target_position_id;
        _principal_event_type := 'top_up';
    END IF;

    -- Principal-side event (carries cost basis from DeFi).
    IF _principal_qty_in > 0 THEN
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
            _principal_event_type,
            _operated_on,
            _principal_qty_in,
            NULL,
            NULL,
            NULL,
            COALESCE(_comment_clean, 'Частичный возврат принципала из DeFi'),
            jsonb_build_object(
                'action', 'partial_return_from_protocol',
                'protocol_position_id', _position_id,
                'protocol_name', _existing.protocol_name,
                'entry_value_in_base',
                    CASE WHEN _existing.quantity > 0
                        THEN round(_existing.cost_basis_in_base * _principal_qty_in / _existing.quantity, 2)
                        ELSE 0
                    END,
                'source_kind', 'defi_return',
                'source_protocol_position_id', _position_id
            ),
            _user_id
        );
    END IF;

    -- Rewards-side event (zero cost income).
    IF _rewards_qty_in > 0 THEN
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
            _operated_on,
            _rewards_qty_in,
            NULL,
            NULL,
            NULL,
            COALESCE(_comment_clean, 'Награды из DeFi-протокола'),
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

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
