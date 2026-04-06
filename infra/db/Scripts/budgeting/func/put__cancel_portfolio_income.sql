DROP FUNCTION IF EXISTS budgeting.put__cancel_portfolio_income;
CREATE FUNCTION budgeting.put__cancel_portfolio_income(
    _user_id bigint,
    _event_id bigint,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _position_id bigint;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _investment_account_id bigint;
    _position_title text;
    _linked_operation_id bigint;
    _amount numeric(20, 8);
    _currency_code char(3);
    _base_currency_code char(3);
    _bank_balance numeric(20, 8);
    _operation_id bigint;
    _operation_comment text;
    _bank_cost_delta numeric(20, 2) := 0;
    _current_income_in_base numeric(20, 2);
    _created_lot record;
BEGIN
    SET search_path TO budgeting;

    SELECT
        pe.position_id,
        pp.owner_type,
        pp.owner_user_id,
        pp.owner_family_id,
        pp.investment_account_id,
        pp.title,
        pe.linked_operation_id,
        pe.amount,
        pe.currency_code
    INTO
        _position_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        _position_title,
        _linked_operation_id,
        _amount,
        _currency_code
    FROM portfolio_events pe
    JOIN portfolio_positions pp
      ON pp.id = pe.position_id
    WHERE pe.id = _event_id
      AND pe.event_type = 'income';

    IF _position_id IS NULL THEN
        RAISE EXCEPTION 'Unknown income event %', _event_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio income event %', _event_id;
    END IF;

    IF _linked_operation_id IS NULL THEN
        RAISE EXCEPTION 'Income event % is missing linked operation', _event_id;
    END IF;

    PERFORM 1
    FROM operations o
    WHERE o.id = _linked_operation_id
      AND o.type = 'investment_income';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Income operation is missing for event %', _event_id;
    END IF;

    PERFORM 1
    FROM portfolio_events pe
    WHERE pe.position_id = _position_id
      AND pe.event_type = 'adjustment'
      AND (pe.metadata ->> 'action') = 'cancel_income'
      AND (pe.metadata ->> 'cancelled_event_id')::bigint = _event_id;

    IF FOUND THEN
        RAISE EXCEPTION 'Income event % was already cancelled', _event_id;
    END IF;

    PERFORM 1
    FROM bank_accounts ba
    WHERE ba.id = _investment_account_id
      AND ba.is_active
      AND ba.account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for income event %', _event_id;
    END IF;

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

    _bank_balance := COALESCE(_bank_balance, 0);

    IF _bank_balance < _amount THEN
        RAISE EXCEPTION 'Insufficient bank balance for cancelling portfolio income';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    FOR _created_lot IN
        SELECT id, amount_initial, amount_remaining, cost_base_initial, cost_base_remaining
        FROM fx_lots
        WHERE opened_by_operation_id = _linked_operation_id
    LOOP
        IF _created_lot.amount_remaining <> _created_lot.amount_initial
           OR _created_lot.cost_base_remaining <> _created_lot.cost_base_initial THEN
            RAISE EXCEPTION 'Cannot cancel income event % because the received currency was already used', _event_id;
        END IF;

        _bank_cost_delta := _bank_cost_delta + _created_lot.cost_base_initial;
    END LOOP;

    IF _bank_cost_delta = 0 THEN
        IF _currency_code = _base_currency_code THEN
            _bank_cost_delta := round(_amount, 2);
        ELSE
            RAISE EXCEPTION 'Cannot cancel income event % because historical cost is missing', _event_id;
        END IF;
    END IF;

    SELECT COALESCE((metadata ->> 'income_in_base')::numeric, 0)
    INTO _current_income_in_base
    FROM portfolio_positions
    WHERE id = _position_id;

    _operation_comment := 'Отмена дохода · ' || _position_title;
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
        'investment_adjustment',
        _operation_comment
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _investment_account_id, _currency_code, -_amount);

    UPDATE fx_lots
    SET amount_remaining = 0,
        cost_base_remaining = 0
    WHERE opened_by_operation_id = _linked_operation_id;

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _currency_code,
        -_amount,
        -_bank_cost_delta
    );

    UPDATE portfolio_positions
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{income_in_base}',
        to_jsonb(GREATEST(_current_income_in_base - _bank_cost_delta, 0)),
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
        'adjustment',
        CURRENT_DATE,
        -_amount,
        _currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object(
            'action', 'cancel_income',
            'cancelled_event_id', _event_id,
            'source_operation_id', _linked_operation_id,
            'amount_in_base', -_bank_cost_delta
        ),
        _user_id
    );

    RETURN jsonb_build_object(
        'status', 'cancelled',
        'event_id', _event_id,
        'operation_id', _operation_id
    );
END
$function$;
