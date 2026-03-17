CREATE OR REPLACE FUNCTION budgeting.put__close_portfolio_position(
    _user_id bigint,
    _position_id bigint,
    _close_amount_in_currency numeric,
    _close_currency_code char(3),
    _closed_at date DEFAULT CURRENT_DATE,
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
    _quantity numeric(20, 8);
BEGIN
    SET search_path TO budgeting;

    IF _close_amount_in_currency IS NULL OR _close_amount_in_currency <= 0 THEN
        RAISE EXCEPTION 'Close amount must be positive';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, status, quantity
    INTO _owner_type, _owner_user_id, _owner_family_id, _status, _quantity
    FROM portfolio_positions
    WHERE id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    IF _status <> 'open' THEN
        RAISE EXCEPTION 'Portfolio position % is already closed', _position_id;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _close_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown currency code: %', _close_currency_code;
    END IF;

    UPDATE portfolio_positions
    SET status = 'closed',
        closed_at = COALESCE(_closed_at, CURRENT_DATE),
        close_amount_in_currency = _close_amount_in_currency,
        close_currency_code = _close_currency_code,
        comment = COALESCE(NULLIF(btrim(_comment), ''), comment)
    WHERE id = _position_id;

    INSERT INTO portfolio_events (
        position_id,
        event_type,
        event_at,
        quantity,
        amount,
        currency_code,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _position_id,
        'close',
        COALESCE(_closed_at, CURRENT_DATE),
        _quantity,
        _close_amount_in_currency,
        _close_currency_code,
        NULLIF(btrim(_comment), ''),
        '{}'::jsonb,
        _user_id
    );

    RETURN budgeting.get__portfolio_position(_user_id, _position_id);
END
$function$;
