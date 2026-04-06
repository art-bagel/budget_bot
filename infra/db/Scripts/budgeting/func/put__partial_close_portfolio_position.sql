DROP FUNCTION IF EXISTS budgeting.put__partial_close_portfolio_position;
CREATE FUNCTION budgeting.put__partial_close_portfolio_position(
    _user_id bigint,
    _position_id bigint,
    _return_amount_in_currency numeric,
    _return_currency_code char(3),
    _principal_reduction_in_currency numeric,
    _return_amount_in_base numeric DEFAULT NULL,
    _closed_quantity numeric DEFAULT NULL,
    _closed_at date DEFAULT CURRENT_DATE,
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
    _current_quantity numeric(20, 8);
    _current_amount_in_currency numeric(20, 8);
    _current_amount_in_base numeric(20, 2);
    _current_realized_result_in_base numeric(20, 2);
    _current_returned_amount_in_base numeric(20, 2);
    _investment_account_id bigint;
    _title text;
    _base_currency_code char(3);
    _effective_return_amount_in_base numeric(20, 2);
    _released_principal_in_base numeric(20, 2);
    _remaining_amount_in_base numeric(20, 2);
    _next_realized_result_in_base numeric(20, 2);
    _next_returned_amount_in_base numeric(20, 2);
    _operation_id bigint;
    _operation_comment text;
BEGIN
    SET search_path TO budgeting;

    IF _return_amount_in_currency IS NULL OR _return_amount_in_currency <= 0 THEN
        RAISE EXCEPTION 'Partial close return amount must be positive';
    END IF;

    IF _principal_reduction_in_currency IS NULL OR _principal_reduction_in_currency <= 0 THEN
        RAISE EXCEPTION 'Partial close principal reduction must be positive';
    END IF;

    IF _closed_quantity IS NOT NULL AND _closed_quantity <= 0 THEN
        RAISE EXCEPTION 'Partial close quantity must be positive when provided';
    END IF;

    SELECT
        owner_type,
        owner_user_id,
        owner_family_id,
        status,
        quantity,
        amount_in_currency,
        COALESCE((metadata ->> 'amount_in_base')::numeric, 0),
        COALESCE((metadata ->> 'realized_result_in_base')::numeric, 0),
        COALESCE((metadata ->> 'returned_amount_in_base')::numeric, 0),
        investment_account_id,
        title
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _status,
        _current_quantity,
        _current_amount_in_currency,
        _current_amount_in_base,
        _current_realized_result_in_base,
        _current_returned_amount_in_base,
        _investment_account_id,
        _title
    FROM portfolio_positions
    WHERE id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    IF _status <> 'open' THEN
        RAISE EXCEPTION 'Portfolio position % must be open for partial close', _position_id;
    END IF;

    IF _principal_reduction_in_currency >= _current_amount_in_currency THEN
        RAISE EXCEPTION 'Partial close must leave a positive position остаток; use full close instead';
    END IF;

    IF _current_quantity IS NULL THEN
        IF _closed_quantity IS NOT NULL THEN
            RAISE EXCEPTION 'Partial close quantity is not supported for positions without tracked quantity';
        END IF;
    ELSE
        IF _closed_quantity IS NULL THEN
            RAISE EXCEPTION 'Closed quantity is required for positions with tracked quantity';
        END IF;

        IF _closed_quantity >= _current_quantity THEN
            RAISE EXCEPTION 'Partial close quantity must be smaller than current quantity; use full close instead';
        END IF;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _return_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown currency code: %', _return_currency_code;
    END IF;

    PERFORM 1
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active
      AND account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for portfolio position %', _position_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _return_currency_code = _base_currency_code THEN
        _effective_return_amount_in_base := round(_return_amount_in_currency, 2);
    ELSE
        IF _return_amount_in_base IS NULL OR _return_amount_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency partial close';
        END IF;

        _effective_return_amount_in_base := round(_return_amount_in_base, 2);
    END IF;

    _released_principal_in_base := round(
        _current_amount_in_base * _principal_reduction_in_currency / _current_amount_in_currency,
        2
    );
    _remaining_amount_in_base := _current_amount_in_base - _released_principal_in_base;
    _next_realized_result_in_base := _current_realized_result_in_base
        + (_effective_return_amount_in_base - _released_principal_in_base);
    _next_returned_amount_in_base := _current_returned_amount_in_base + _effective_return_amount_in_base;

    _operation_comment := 'Частичное закрытие позиции · ' || _title;
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
        created_at
    )
    VALUES (
        _user_id,
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'investment_trade',
        _operation_comment,
        COALESCE(_operation_at, CURRENT_TIMESTAMP)
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
    VALUES (_operation_id, _investment_account_id, _return_currency_code, _return_amount_in_currency);

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _return_currency_code,
        _return_amount_in_currency,
        _effective_return_amount_in_base
    );

    IF _return_currency_code <> _base_currency_code THEN
        INSERT INTO fx_lots (
            bank_account_id,
            currency_code,
            amount_initial,
            amount_remaining,
            buy_rate_in_base,
            cost_base_initial,
            cost_base_remaining,
            opened_by_operation_id
        )
        VALUES (
            _investment_account_id,
            _return_currency_code,
            _return_amount_in_currency,
            _return_amount_in_currency,
            _effective_return_amount_in_base / _return_amount_in_currency,
            _effective_return_amount_in_base,
            _effective_return_amount_in_base,
            _operation_id
        );
    END IF;

    UPDATE portfolio_positions
    SET amount_in_currency = amount_in_currency - _principal_reduction_in_currency,
        quantity = CASE
            WHEN quantity IS NULL THEN NULL
            ELSE quantity - _closed_quantity
        END,
        metadata = jsonb_set(
            jsonb_set(
                jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{amount_in_base}',
                    to_jsonb(_remaining_amount_in_base),
                    true
                ),
                '{realized_result_in_base}',
                to_jsonb(_next_realized_result_in_base),
                true
            ),
            '{returned_amount_in_base}',
            to_jsonb(_next_returned_amount_in_base),
            true
        )
    WHERE id = _position_id;

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
        'partial_close',
        COALESCE(_closed_at, CURRENT_DATE),
        _closed_quantity,
        _return_amount_in_currency,
        _return_currency_code,
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object(
            'amount_in_base', _effective_return_amount_in_base,
            'principal_amount_in_currency', _principal_reduction_in_currency,
            'principal_amount_in_base', _released_principal_in_base
        ),
        _user_id
    );

    RETURN budgeting.get__portfolio_position(_user_id, _position_id);
END
$function$;
