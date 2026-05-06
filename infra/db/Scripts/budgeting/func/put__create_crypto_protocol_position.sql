DROP FUNCTION IF EXISTS budgeting.put__create_crypto_protocol_position;
CREATE FUNCTION budgeting.put__create_crypto_protocol_position(
    _user_id bigint,
    _investment_account_id bigint,
    _protocol_name text,
    _position_type text,
    _asset_symbol text,
    _quantity numeric DEFAULT NULL,
    _cost_basis_in_base numeric DEFAULT 0,
    _current_quantity numeric DEFAULT NULL,
    _current_value_in_base numeric DEFAULT 0,
    _rewards_claimed_in_base numeric DEFAULT 0,
    _rewards_unclaimed_in_base numeric DEFAULT 0,
    _crypto_asset_id bigint DEFAULT NULL,
    _network_code text DEFAULT NULL,
    _deposited_at date DEFAULT NULL,
    _comment text DEFAULT NULL,
    _metadata jsonb DEFAULT '{}'::jsonb,
    _source_position_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _investment_asset_type text;
    _position_id bigint;
    _source_position record;
    _remaining_quantity numeric(30, 12);
    _asset record;
    _asset_symbol_resolved text;
    _entry_summary jsonb;
    _remaining_basis numeric(20, 2);
    _consumed_cost_basis numeric(20, 2);
    _source_quantity numeric(30, 12);
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, investment_asset_type
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind, _investment_asset_type
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF _account_kind <> 'investment' OR _investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Protocol positions require a crypto investment account';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    IF NULLIF(btrim(_protocol_name), '') IS NULL THEN
        RAISE EXCEPTION 'Protocol name is required';
    END IF;

    IF _position_type NOT IN ('staking', 'lending', 'liquidity_pool', 'vault', 'other') THEN
        RAISE EXCEPTION 'Unsupported protocol position type: %', _position_type;
    END IF;

    IF _source_position_id IS NOT NULL THEN
        SELECT *
        INTO _source_position
        FROM portfolio_positions
        WHERE id = _source_position_id
          AND status = 'open'
        FOR UPDATE;

        IF _source_position.id IS NULL THEN
            RAISE EXCEPTION 'Unknown open crypto asset position %', _source_position_id;
        END IF;

        IF _source_position.investment_account_id <> _investment_account_id
           OR _source_position.asset_type_code <> 'crypto' THEN
            RAISE EXCEPTION 'Source position must be an open crypto asset on the same account';
        END IF;

        IF _quantity IS NULL OR _quantity <= 0 THEN
            RAISE EXCEPTION 'Protocol source quantity must be positive';
        END IF;

        _quantity := round(_quantity, 12);
        _source_quantity := COALESCE(_source_position.quantity, 0);

        IF _source_quantity < _quantity THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;

        _remaining_quantity := round(_source_quantity - _quantity, 12);

        -- Compute weighted-average cost basis to carry into DeFi.
        _entry_summary := budgeting.get__crypto_position_entry_summary(_source_position_id);
        _remaining_basis := COALESCE((_entry_summary ->> 'remaining_cost_basis')::numeric, 0);
        _consumed_cost_basis := CASE
            WHEN _source_quantity > 0
                THEN round(_remaining_basis * _quantity / _source_quantity, 2)
            ELSE 0
        END;
        _crypto_asset_id := COALESCE(_crypto_asset_id, (_source_position.metadata ->> 'crypto_asset_id')::bigint);
        _network_code := COALESCE(NULLIF(btrim(_network_code), ''), NULLIF(btrim(_source_position.metadata ->> 'network_code'), ''));
        _asset_symbol_resolved := COALESCE(
            NULLIF(btrim(_asset_symbol), ''),
            NULLIF(btrim(_source_position.metadata ->> 'asset_symbol'), ''),
            NULLIF(btrim(_source_position.title), '')
        );

        IF _crypto_asset_id IS NOT NULL THEN
            SELECT *
            INTO _asset
            FROM crypto_assets
            WHERE id = _crypto_asset_id;

            IF _asset.id IS NOT NULL THEN
                _asset_symbol_resolved := COALESCE(_asset_symbol_resolved, _asset.symbol);
                _network_code := COALESCE(_network_code, _asset.network_code);
            END IF;
        END IF;

        IF _crypto_asset_id IS NULL OR _asset_symbol_resolved IS NULL THEN
            RAISE EXCEPTION 'Unable to resolve source crypto asset for protocol position';
        END IF;

        -- Carry the consumed cost basis from source asset into DeFi position.
        -- DeFi does not "create" value: principal returns at the same basis when closed.
        _cost_basis_in_base := _consumed_cost_basis;
        _current_quantity := COALESCE(_current_quantity, _quantity);
        -- Initial current_value_in_base = consumed cost basis if not provided by caller.
        _current_value_in_base := COALESCE(NULLIF(_current_value_in_base, 0), _consumed_cost_basis);
        _metadata := COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object(
            'source_position_id', _source_position_id,
            'source_asset_symbol', _asset_symbol_resolved,
            'source_network_code', _network_code,
            'cost_basis_carried', _consumed_cost_basis
        );
        _asset_symbol := _asset_symbol_resolved;

        IF _remaining_quantity <= 0 THEN
            UPDATE portfolio_positions
            SET status = 'closed',
                quantity = 0,
                closed_at = COALESCE(_deposited_at, current_date),
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
            _source_position_id,
            'transfer_out',
            COALESCE(_deposited_at, current_date),
            _quantity,
            NULL,
            NULL,
            NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Перевод в DeFi-протокол'),
            jsonb_build_object(
                'action', 'stake_to_protocol',
                'protocol_name', btrim(_protocol_name),
                'position_type', _position_type,
                'protocol_asset_symbol', _asset_symbol_resolved,
                'protocol_quantity', _quantity,
                'value_in_base', _consumed_cost_basis,
                'consumed_cost_basis', _consumed_cost_basis,
                'realized_in_base', 0,
                'target_kind', 'defi'
            ),
            _user_id
        );
    ELSE
        IF NULLIF(btrim(_asset_symbol), '') IS NULL THEN
            RAISE EXCEPTION 'Asset symbol is required';
        END IF;
    END IF;

    INSERT INTO crypto_protocol_positions (
        owner_type,
        owner_user_id,
        owner_family_id,
        investment_account_id,
        crypto_asset_id,
        protocol_name,
        position_type,
        network_code,
        asset_symbol,
        quantity,
        cost_basis_in_base,
        current_quantity,
        current_value_in_base,
        rewards_claimed_in_base,
        rewards_unclaimed_in_base,
        deposited_at,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        _crypto_asset_id,
        btrim(_protocol_name),
        _position_type,
        NULLIF(btrim(_network_code), ''),
        btrim(_asset_symbol),
        _quantity,
        COALESCE(_cost_basis_in_base, 0),
        COALESCE(_current_quantity, _quantity),
        COALESCE(_current_value_in_base, _cost_basis_in_base, 0),
        COALESCE(_rewards_claimed_in_base, 0),
        COALESCE(_rewards_unclaimed_in_base, 0),
        COALESCE(_deposited_at, current_date),
        NULLIF(btrim(_comment), ''),
        COALESCE(_metadata, '{}'::jsonb),
        _user_id
    )
    RETURNING id INTO _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;
