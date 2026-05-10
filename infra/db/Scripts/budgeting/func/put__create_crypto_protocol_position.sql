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
    _source_position_id bigint DEFAULT NULL,
    _secondary_source_position_id bigint DEFAULT NULL,
    _secondary_quantity numeric DEFAULT NULL,
    _borrowed_crypto_asset_id bigint DEFAULT NULL,
    _borrowed_quantity numeric DEFAULT NULL,
    _borrowed_value_in_base numeric DEFAULT NULL
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
    _secondary_position record;
    _secondary_remaining_quantity numeric(30, 12);
    _secondary_asset record;
    _secondary_asset_symbol_resolved text;
    _secondary_network_code text;
    _secondary_crypto_asset_id bigint;
    _secondary_entry_summary jsonb;
    _secondary_remaining_basis numeric(20, 2);
    _secondary_consumed_cost_basis numeric(20, 2);
    _secondary_source_quantity numeric(30, 12);
    _borrow_asset record;
    _borrow_position_id bigint;
    _borrow_existing record;
    _borrow_asset_metadata jsonb;
    _borrow_value_in_base numeric(20, 2);
    _base_currency_code char(3);
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

    IF _secondary_source_position_id IS NOT NULL AND _position_type <> 'liquidity_pool' THEN
        RAISE EXCEPTION 'Secondary source position is only allowed for liquidity_pool positions';
    END IF;

    IF _secondary_source_position_id IS NOT NULL AND _secondary_source_position_id = _source_position_id THEN
        RAISE EXCEPTION 'Token B must differ from token A';
    END IF;

    IF (_borrowed_crypto_asset_id IS NOT NULL OR (_borrowed_quantity IS NOT NULL AND _borrowed_quantity > 0))
       AND _position_type <> 'lending' THEN
        RAISE EXCEPTION 'Borrow params are only allowed for lending positions';
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
                'target_kind', 'defi',
                'token_role', 'token_a'
            ),
            _user_id
        );
    ELSE
        IF NULLIF(btrim(_asset_symbol), '') IS NULL THEN
            RAISE EXCEPTION 'Asset symbol is required';
        END IF;
    END IF;

    -- Token B (only for liquidity_pool): same locking + decrement + transfer_out + cost-basis carry.
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

        IF _secondary_position.investment_account_id <> _investment_account_id
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

        _secondary_crypto_asset_id := (_secondary_position.metadata ->> 'crypto_asset_id')::bigint;
        _secondary_network_code := NULLIF(btrim(_secondary_position.metadata ->> 'network_code'), '');
        _secondary_asset_symbol_resolved := COALESCE(
            NULLIF(btrim(_secondary_position.metadata ->> 'asset_symbol'), ''),
            NULLIF(btrim(_secondary_position.title), '')
        );

        IF _secondary_crypto_asset_id IS NOT NULL THEN
            SELECT *
            INTO _secondary_asset
            FROM crypto_assets
            WHERE id = _secondary_crypto_asset_id;

            IF _secondary_asset.id IS NOT NULL THEN
                _secondary_asset_symbol_resolved := COALESCE(_secondary_asset_symbol_resolved, _secondary_asset.symbol);
            END IF;
        END IF;

        IF _secondary_asset_symbol_resolved IS NULL THEN
            RAISE EXCEPTION 'Unable to resolve token B asset symbol';
        END IF;

        -- Aggregate cost basis: protocol position carries A + B.
        _cost_basis_in_base := COALESCE(_cost_basis_in_base, 0) + _secondary_consumed_cost_basis;
        _current_value_in_base := COALESCE(_current_value_in_base, 0) + _secondary_consumed_cost_basis;

        _metadata := COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object(
            'token1_position_id', _secondary_source_position_id,
            'token1_symbol', _secondary_asset_symbol_resolved,
            'token1_quantity', _secondary_quantity,
            'token1_crypto_asset_id', _secondary_crypto_asset_id,
            'token1_cost_basis_carried', _secondary_consumed_cost_basis
        );

        IF _secondary_remaining_quantity <= 0 THEN
            UPDATE portfolio_positions
            SET status = 'closed',
                quantity = 0,
                closed_at = COALESCE(_deposited_at, current_date),
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
            _secondary_source_position_id,
            'transfer_out',
            COALESCE(_deposited_at, current_date),
            _secondary_quantity,
            NULL,
            NULL,
            NULL,
            COALESCE(NULLIF(btrim(_comment), ''), 'Перевод в DeFi-протокол'),
            jsonb_build_object(
                'action', 'stake_to_protocol',
                'protocol_name', btrim(_protocol_name),
                'position_type', _position_type,
                'protocol_asset_symbol', _secondary_asset_symbol_resolved,
                'protocol_quantity', _secondary_quantity,
                'value_in_base', _secondary_consumed_cost_basis,
                'consumed_cost_basis', _secondary_consumed_cost_basis,
                'realized_in_base', 0,
                'target_kind', 'defi',
                'token_role', 'token_b'
            ),
            _user_id
        );
    END IF;

    -- Borrow (lending only): credit borrowed crypto asset to the same account.
    -- Cost basis = 0 — borrowed funds are debt, not user equity.
    IF _position_type = 'lending'
       AND _borrowed_crypto_asset_id IS NOT NULL
       AND _borrowed_quantity IS NOT NULL
       AND _borrowed_quantity > 0
    THEN
        _borrowed_quantity := round(_borrowed_quantity, 12);
        _borrow_value_in_base := round(COALESCE(_borrowed_value_in_base, 0), 2);
        _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

        SELECT *
        INTO _borrow_asset
        FROM crypto_assets
        WHERE id = _borrowed_crypto_asset_id;

        IF _borrow_asset.id IS NULL THEN
            RAISE EXCEPTION 'Unknown borrowed crypto asset %', _borrowed_crypto_asset_id;
        END IF;

        _borrow_asset_metadata := jsonb_build_object(
            'crypto_kind', 'spot',
            'crypto_asset_id', _borrow_asset.id,
            'asset_symbol', _borrow_asset.symbol,
            'asset_name', _borrow_asset.name,
            'network_code', _borrow_asset.network_code,
            'contract_address', _borrow_asset.contract_address
        );

        SELECT *
        INTO _borrow_existing
        FROM portfolio_positions
        WHERE investment_account_id = _investment_account_id
          AND asset_type_code = 'crypto'
          AND status = 'open'
          AND COALESCE((metadata ->> 'crypto_asset_id')::bigint, 0) = _borrow_asset.id
        ORDER BY opened_at ASC, id ASC
        LIMIT 1
        FOR UPDATE;

        IF _borrow_existing.id IS NOT NULL THEN
            UPDATE portfolio_positions
            SET quantity = COALESCE(quantity, 0) + _borrowed_quantity,
                amount_in_currency = 0,
                metadata = metadata || _borrow_asset_metadata
            WHERE id = _borrow_existing.id;
            _borrow_position_id := _borrow_existing.id;

            INSERT INTO portfolio_events (
                position_id, event_type, event_at, quantity, amount, currency_code,
                linked_operation_id, comment, metadata, created_by_user_id
            )
            VALUES (
                _borrow_position_id,
                'top_up',
                COALESCE(_deposited_at, current_date),
                _borrowed_quantity,
                NULL, NULL, NULL,
                COALESCE(NULLIF(btrim(_comment), ''), 'Получено в долг (лендинг)'),
                _borrow_asset_metadata || jsonb_build_object(
                    'action', 'lending_borrow',
                    'protocol_name', btrim(_protocol_name),
                    'entry_value_in_base', 0,
                    'source_kind', 'lending_borrow',
                    'value_in_base', _borrow_value_in_base
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
                _owner_type, _owner_user_id, _owner_family_id, _investment_account_id,
                'crypto', _borrow_asset.symbol, _borrowed_quantity, 0, _base_currency_code,
                COALESCE(_deposited_at, current_date),
                COALESCE(NULLIF(btrim(_comment), ''), 'Получено в долг (лендинг)'),
                _borrow_asset_metadata,
                _user_id
            )
            RETURNING id INTO _borrow_position_id;

            INSERT INTO portfolio_events (
                position_id, event_type, event_at, quantity, amount, currency_code,
                linked_operation_id, comment, metadata, created_by_user_id
            )
            VALUES (
                _borrow_position_id,
                'open',
                COALESCE(_deposited_at, current_date),
                _borrowed_quantity,
                NULL, NULL, NULL,
                COALESCE(NULLIF(btrim(_comment), ''), 'Получено в долг (лендинг)'),
                _borrow_asset_metadata || jsonb_build_object(
                    'action', 'lending_borrow',
                    'protocol_name', btrim(_protocol_name),
                    'entry_value_in_base', 0,
                    'source_kind', 'lending_borrow',
                    'value_in_base', _borrow_value_in_base
                ),
                _user_id
            );
        END IF;

        _metadata := COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object(
            'borrowed_crypto_asset_id', _borrow_asset.id,
            'borrowed_asset', _borrow_asset.symbol,
            'borrowed_asset_symbol', _borrow_asset.symbol,
            'borrowed_quantity', _borrowed_quantity,
            'borrowed_position_id', _borrow_position_id,
            'borrowed_value_in_base', _borrow_value_in_base
        );
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
