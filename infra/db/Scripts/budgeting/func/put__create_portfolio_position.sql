CREATE OR REPLACE FUNCTION budgeting.put__create_portfolio_position(
    _user_id bigint,
    _investment_account_id bigint,
    _asset_type_code text,
    _title text,
    _quantity numeric DEFAULT NULL,
    _amount_in_currency numeric DEFAULT NULL,
    _currency_code char(3) DEFAULT NULL,
    _opened_at date DEFAULT CURRENT_DATE,
    _comment text DEFAULT NULL,
    _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _position_id bigint;
    _operation_id bigint;
    _normalized_title text := btrim(_title);
    _normalized_asset_type text := lower(btrim(_asset_type_code));
    _base_currency_code char(3);
    _bank_balance numeric(20, 8);
    _remaining_to_consume numeric(20, 8);
    _cost_base numeric(20, 2) := 0;
    _lot_ids bigint[] := '{}';
    _lot_amounts numeric[] := '{}';
    _lot_costs numeric[] := '{}';
    _lot_idx integer;
    _consume_amount numeric(20, 8);
    _consume_cost numeric(20, 2);
    _lot record;
    _operation_comment text;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_title = '' THEN
        RAISE EXCEPTION 'Portfolio position title cannot be empty';
    END IF;

    IF _normalized_asset_type = '' OR _normalized_asset_type !~ '^[a-z][a-z0-9_]{1,29}$' THEN
        RAISE EXCEPTION 'Unsupported asset type code: %', _asset_type_code;
    END IF;

    IF _amount_in_currency IS NULL OR _amount_in_currency <= 0 THEN
        RAISE EXCEPTION 'Position amount must be positive';
    END IF;

    IF _quantity IS NOT NULL AND _quantity <= 0 THEN
        RAISE EXCEPTION 'Position quantity must be positive when provided';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _investment_account_id;
    END IF;

    IF _account_kind <> 'investment' THEN
        RAISE EXCEPTION 'Portfolio positions can only be created for investment accounts';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown currency code: %', _currency_code;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    PERFORM 1
    FROM current_bank_balances
    WHERE bank_account_id = _investment_account_id
      AND currency_code = _currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0)
    INTO _bank_balance
    FROM current_bank_balances
    WHERE bank_account_id = _investment_account_id
      AND currency_code = _currency_code;

    IF _bank_balance < _amount_in_currency THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    IF _currency_code = _base_currency_code THEN
        _cost_base := round(_amount_in_currency, 2);
    ELSE
        _remaining_to_consume := _amount_in_currency;

        FOR _lot IN
            SELECT id, amount_remaining, cost_base_remaining
            FROM fx_lots
            WHERE bank_account_id = _investment_account_id
              AND currency_code = _currency_code
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
            _cost_base := _cost_base + _consume_cost;
            _remaining_to_consume := _remaining_to_consume - _consume_amount;
        END LOOP;

        IF _remaining_to_consume > 0 THEN
            RAISE EXCEPTION 'Сумма превышает остаток';
        END IF;
    END IF;

    _operation_comment := 'Открытие позиции · ' || _normalized_title;
    IF NULLIF(btrim(_comment), '') IS NOT NULL THEN
        _operation_comment := _operation_comment || ' · ' || NULLIF(btrim(_comment), '');
    END IF;

    INSERT INTO operations (
        actor_user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        type,
        comment
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'investment_trade',
        _operation_comment
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _investment_account_id, _currency_code, -_amount_in_currency);

    IF array_length(_lot_ids, 1) IS NOT NULL THEN
        FOR _lot_idx IN 1..array_length(_lot_ids, 1) LOOP
            UPDATE fx_lots
            SET amount_remaining = amount_remaining - _lot_amounts[_lot_idx],
                cost_base_remaining = cost_base_remaining - _lot_costs[_lot_idx]
            WHERE id = _lot_ids[_lot_idx];

            INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
            VALUES (_operation_id, _lot_ids[_lot_idx], _lot_amounts[_lot_idx], _lot_costs[_lot_idx]);
        END LOOP;
    END IF;

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _currency_code,
        -_amount_in_currency,
        -_cost_base
    );

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
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        _normalized_asset_type,
        _normalized_title,
        _quantity,
        _amount_in_currency,
        _currency_code,
        COALESCE(_opened_at, CURRENT_DATE),
        NULLIF(btrim(_comment), ''),
        jsonb_build_object('amount_in_base', _cost_base) || COALESCE(_metadata, '{}'::jsonb),
        _user_id
    )
    RETURNING id
    INTO _position_id;

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
        _position_id,
        'open',
        COALESCE(_opened_at, CURRENT_DATE),
        _quantity,
        _amount_in_currency,
        _currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object('amount_in_base', _cost_base) || COALESCE(_metadata, '{}'::jsonb),
        _user_id
    );

    RETURN budgeting.get__portfolio_position(_user_id, _position_id);
END
$function$;
