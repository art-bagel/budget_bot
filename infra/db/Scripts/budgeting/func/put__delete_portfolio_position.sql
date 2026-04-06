DROP FUNCTION IF EXISTS budgeting.put__delete_portfolio_position;
CREATE FUNCTION budgeting.put__delete_portfolio_position(
    _user_id bigint,
    _position_id bigint,
    _comment text DEFAULT NULL
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
    _open_event_id bigint;
    _open_operation_id bigint;
    _open_amount numeric(20, 8);
    _open_currency_code char(3);
    _open_amount_in_base numeric(20, 2);
    _events_count integer;
    _operation_id bigint;
    _operation_comment text;
    _bank_cost_delta numeric(20, 2) := 0;
    _consumption record;
BEGIN
    SET search_path TO budgeting;

    SELECT
        pp.owner_type,
        pp.owner_user_id,
        pp.owner_family_id,
        pp.status,
        pp.investment_account_id,
        pp.title,
        (pp.metadata ->> 'amount_in_base')::numeric
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _status,
        _investment_account_id,
        _title,
        _open_amount_in_base
    FROM portfolio_positions pp
    WHERE pp.id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    IF _status <> 'open' THEN
        RAISE EXCEPTION 'Only open positions can be deleted';
    END IF;

    SELECT count(*)
    INTO _events_count
    FROM portfolio_events pe
    WHERE pe.position_id = _position_id;

    IF _events_count <> 1 THEN
        RAISE EXCEPTION 'Position can only be deleted when it has no income or close events';
    END IF;

    SELECT
        pe.id,
        pe.linked_operation_id,
        pe.amount,
        pe.currency_code,
        COALESCE((pe.metadata ->> 'amount_in_base')::numeric, _open_amount_in_base)
    INTO
        _open_event_id,
        _open_operation_id,
        _open_amount,
        _open_currency_code,
        _open_amount_in_base
    FROM portfolio_events pe
    WHERE pe.position_id = _position_id
      AND pe.event_type = 'open'
    LIMIT 1;

    IF _open_event_id IS NULL OR _open_operation_id IS NULL THEN
        RAISE EXCEPTION 'Open event is missing for portfolio position %', _position_id;
    END IF;

    PERFORM 1
    FROM operations o
    WHERE o.id = _open_operation_id
      AND o.type = 'investment_trade';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Open trade operation is missing for portfolio position %', _position_id;
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

    _operation_comment := 'Удаление позиции · ' || _title;
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
    VALUES (_operation_id, _investment_account_id, _open_currency_code, _open_amount);

    FOR _consumption IN
        SELECT lot_id, amount, cost_base
        FROM lot_consumptions
        WHERE operation_id = _open_operation_id
    LOOP
        UPDATE fx_lots
        SET amount_remaining = amount_remaining + _consumption.amount,
            cost_base_remaining = cost_base_remaining + _consumption.cost_base
        WHERE id = _consumption.lot_id;

        INSERT INTO lot_consumptions (operation_id, lot_id, amount, cost_base)
        VALUES (_operation_id, _consumption.lot_id, -_consumption.amount, -_consumption.cost_base);

        _bank_cost_delta := _bank_cost_delta + _consumption.cost_base;
    END LOOP;

    IF _bank_cost_delta = 0 THEN
        IF _open_currency_code = _base_currency_code THEN
            _bank_cost_delta := round(_open_amount, 2);
        ELSE
            _bank_cost_delta := COALESCE(_open_amount_in_base, 0);
        END IF;
    END IF;

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _open_currency_code,
        _open_amount,
        _bank_cost_delta
    );

    DELETE FROM portfolio_events
    WHERE position_id = _position_id;

    DELETE FROM portfolio_positions
    WHERE id = _position_id;

    RETURN jsonb_build_object(
        'status', 'deleted',
        'position_id', _position_id,
        'operation_id', _operation_id
    );
END
$function$;
