DROP FUNCTION IF EXISTS budgeting.put__transfer_crypto_to_investment;
CREATE FUNCTION budgeting.put__transfer_crypto_to_investment(
    _user_id bigint,
    _bank_account_id bigint,
    _investment_account_id bigint,
    _crypto_asset_id bigint,
    _amount numeric,
    _position_id bigint DEFAULT NULL,
    _title text DEFAULT NULL,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _bank_owner_type text;
    _bank_owner_user_id bigint;
    _bank_owner_family_id bigint;
    _bank_account_kind text;
    _investment_owner_type text;
    _investment_owner_user_id bigint;
    _investment_owner_family_id bigint;
    _investment_account_kind text;
    _investment_asset_type text;
    _base_currency_code char(3);
    _from_unallocated_id bigint;
    _crypto_balance numeric(30, 12);
    _remaining_to_consume numeric(30, 12);
    _consumed_cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(30, 12);
    _consume_cost numeric(20, 2);
    _lot record;
    _asset record;
    _operation_id bigint;
    _target_position_id bigint;
    _position record;
    _metadata jsonb;
BEGIN
    SET search_path TO budgeting;

    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Crypto transfer amount must be positive';
    END IF;
    _amount := round(_amount, 12);

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id, _bank_account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, investment_asset_type
    INTO _investment_owner_type, _investment_owner_user_id, _investment_owner_family_id, _investment_account_kind, _investment_asset_type
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _bank_owner_type IS NULL OR _investment_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank or investment account';
    END IF;

    IF _bank_account_kind <> 'cash' THEN
        RAISE EXCEPTION 'Source account must be a cash account';
    END IF;

    IF _investment_account_kind <> 'investment' OR _investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Target account must be a crypto investment account';
    END IF;

    IF _bank_owner_type <> _investment_owner_type
       OR COALESCE(_bank_owner_user_id, 0) <> COALESCE(_investment_owner_user_id, 0)
       OR COALESCE(_bank_owner_family_id, 0) <> COALESCE(_investment_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Banking crypto and investment account must have the same owner';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT *
    INTO _asset
    FROM crypto_assets
    WHERE id = _crypto_asset_id;

    IF _asset.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto asset %', _crypto_asset_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_bank_owner_type, _bank_owner_user_id, _bank_owner_family_id);
    _from_unallocated_id := budgeting.get__owner_system_category_id(
        _bank_owner_type,
        _bank_owner_user_id,
        _bank_owner_family_id,
        'Unallocated'
    );

    IF _from_unallocated_id IS NULL THEN
        RAISE EXCEPTION 'Unallocated category missing for source account %', _bank_account_id;
    END IF;

    PERFORM 1
    FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id
      AND crypto_asset_id = _crypto_asset_id
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _crypto_balance
    FROM current_crypto_balances
    WHERE bank_account_id = _bank_account_id
      AND crypto_asset_id = _crypto_asset_id;

    _crypto_balance := COALESCE(_crypto_balance, 0);
    IF _crypto_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    _remaining_to_consume := _amount;
    FOR _lot IN
        SELECT id, amount_remaining, cost_base_remaining
        FROM crypto_lots
        WHERE bank_account_id = _bank_account_id
          AND crypto_asset_id = _crypto_asset_id
          AND amount_remaining > 0
        ORDER BY created_at, id
    LOOP
        EXIT WHEN _remaining_to_consume <= 0;

        _consume_amount := LEAST(_remaining_to_consume, _lot.amount_remaining);
        IF _consume_amount = _lot.amount_remaining THEN
            _consume_cost := _lot.cost_base_remaining;
        ELSE
            _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
        END IF;

        _lot_ids := array_append(_lot_ids, _lot.id);
        _lot_amounts := array_append(_lot_amounts, _consume_amount);
        _lot_costs := array_append(_lot_costs, _consume_cost);
        _consumed_cost_base := _consumed_cost_base + _consume_cost;
        _remaining_to_consume := _remaining_to_consume - _consume_amount;
    END LOOP;

    IF _remaining_to_consume > 0 THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment,
        operated_on
    )
    VALUES (
        _user_id,
        _bank_owner_type,
        _bank_owner_user_id,
        _bank_owner_family_id,
        'investment_trade',
        COALESCE(_comment, 'Перевод криптовалюты в инвестиции'),
        COALESCE(_operated_at, current_date)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO crypto_bank_entries (operation_id, bank_account_id, crypto_asset_id, amount)
    VALUES (_operation_id, _bank_account_id, _crypto_asset_id, -_amount);

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _from_unallocated_id, _base_currency_code, -_consumed_cost_base);

    FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
        UPDATE crypto_lots
        SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
            cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
        WHERE id = _lot_ids[_lot_idx];

        INSERT INTO crypto_lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
    END LOOP;

    _metadata := jsonb_build_object(
        'crypto_kind', 'spot',
        'crypto_asset_id', _crypto_asset_id,
        'asset_symbol', _asset.symbol,
        'asset_name', _asset.name,
        'network_code', _asset.network_code,
        'contract_address', _asset.contract_address
    );

    IF _position_id IS NULL THEN
        SELECT id
        INTO _position_id
        FROM portfolio_positions
        WHERE investment_account_id = _investment_account_id
          AND asset_type_code = 'crypto'
          AND status = 'open'
          AND COALESCE((metadata ->> 'crypto_asset_id')::bigint, 0) = _crypto_asset_id
        ORDER BY opened_at ASC, id ASC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF _position_id IS NOT NULL THEN
        SELECT *
        INTO _position
        FROM portfolio_positions
        WHERE id = _position_id
          AND status = 'open'
        FOR UPDATE;

        IF _position.id IS NULL THEN
            RAISE EXCEPTION 'Unknown open portfolio position %', _position_id;
        END IF;

        IF _position.investment_account_id <> _investment_account_id
           OR _position.asset_type_code <> 'crypto'
           OR COALESCE((_position.metadata ->> 'crypto_asset_id')::bigint, 0) <> _crypto_asset_id THEN
            RAISE EXCEPTION 'Portfolio position does not match target crypto asset';
        END IF;

        UPDATE portfolio_positions
        SET quantity = COALESCE(quantity, 0) + _amount,
            amount_in_currency = 0,
            metadata = metadata || _metadata
        WHERE id = _position_id
        RETURNING id INTO _target_position_id;

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
            COALESCE(_operated_at, current_date),
            _amount,
            NULL,
            NULL,
            _operation_id,
            NULLIF(btrim(_comment), ''),
            _metadata,
            _user_id
        );
    ELSE
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
            _bank_owner_type,
            _bank_owner_user_id,
            _bank_owner_family_id,
            _investment_account_id,
            'crypto',
            COALESCE(NULLIF(btrim(_title), ''), _asset.symbol),
            _amount,
            0,
            _base_currency_code,
            COALESCE(_operated_at, current_date),
            NULLIF(btrim(_comment), ''),
            _metadata,
            _user_id
        )
        RETURNING id INTO _target_position_id;

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
            COALESCE(_operated_at, current_date),
            _amount,
            NULL,
            NULL,
            _operation_id,
            NULLIF(btrim(_comment), ''),
            _metadata,
            _user_id
        );
    END IF;

    PERFORM budgeting.put__apply_current_crypto_delta(
        _bank_account_id,
        _crypto_asset_id,
        -_amount,
        -_consumed_cost_base
    );

    PERFORM budgeting.put__apply_current_budget_delta(
        _from_unallocated_id,
        _base_currency_code,
        -_consumed_cost_base
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'position_id', _target_position_id,
        'base_currency_code', _base_currency_code
    );
END
$function$;
