DROP FUNCTION IF EXISTS budgeting.put__record_portfolio_fee;
CREATE FUNCTION budgeting.put__record_portfolio_fee(
    _user_id bigint,
    _position_id bigint,
    _amount numeric,
    _currency_code char(3),
    _charged_at date DEFAULT CURRENT_DATE,
    _comment text DEFAULT NULL,
    _operation_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _status text;
    _investment_account_id bigint;
    _title text;
    _base_currency_code char(3);
    _operation_id bigint;
    _operation_comment text;
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
    _next_fees_in_base numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    IF _amount IS NULL OR _amount <= 0 THEN
        RAISE EXCEPTION 'Portfolio fee amount must be positive';
    END IF;

    SELECT
        pp.owner_type,
        pp.owner_user_id,
        pp.owner_family_id,
        pp.status,
        pp.investment_account_id,
        pp.title,
        COALESCE((pp.metadata ->> 'fees_in_base')::numeric, 0)
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _status,
        _investment_account_id,
        _title,
        _next_fees_in_base
    FROM portfolio_positions pp
    WHERE pp.id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    IF _status <> 'open' THEN
        RAISE EXCEPTION 'Only open positions can be charged with a fee';
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown currency code: %', _currency_code;
    END IF;

    PERFORM 1
    FROM bank_accounts ba
    WHERE ba.id = _investment_account_id
      AND ba.is_active
      AND ba.account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for portfolio position %', _position_id;
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

    -- If no row exists, _bank_balance is NULL; treat as zero.
    _bank_balance := COALESCE(_bank_balance, 0);

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Сумма превышает остаток';
    END IF;

    IF _currency_code = _base_currency_code THEN
        _cost_base := round(_amount, 2);
    ELSE
        _remaining_to_consume := _amount;

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

    _operation_comment := 'Комиссия по позиции · ' || _title;
    IF NULLIF(btrim(_comment), '') IS NOT NULL THEN
        _operation_comment := _operation_comment || ' · ' || NULLIF(btrim(_comment), '');
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
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'investment_adjustment',
        _operation_comment,
        COALESCE(_operation_at::date, CURRENT_DATE)
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _investment_account_id, _currency_code, -_amount);

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
        -_amount,
        -_cost_base
    );

    _next_fees_in_base := _next_fees_in_base + _cost_base;

    UPDATE portfolio_positions
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{fees_in_base}',
        to_jsonb(_next_fees_in_base),
        true
    )
    WHERE id = _position_id;

    INSERT INTO portfolio_events (
        position_id,
        event_type,
        event_at,
        amount,
        currency_code,
        linked_operation_id,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _position_id,
        'fee',
        COALESCE(_charged_at, CURRENT_DATE),
        _amount,
        _currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object('amount_in_base', _cost_base),
        _user_id
    );

    RETURN budgeting.get__portfolio_position(_user_id, _position_id);
END
$function$;
