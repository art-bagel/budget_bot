CREATE OR REPLACE FUNCTION budgeting.put__close_portfolio_position(
    _user_id bigint,
    _position_id bigint,
    _close_amount_in_currency numeric,
    _close_currency_code char(3),
    _close_amount_in_base numeric DEFAULT NULL,
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
    _investment_account_id bigint;
    _title text;
    _base_currency_code char(3);
    _effective_close_amount_in_base numeric(20, 2);
    _operation_id bigint;
    _operation_comment text;
BEGIN
    SET search_path TO budgeting;

    IF _close_amount_in_currency IS NULL OR _close_amount_in_currency <= 0 THEN
        RAISE EXCEPTION 'Close amount must be positive';
    END IF;

    SELECT owner_type, owner_user_id, owner_family_id, status, quantity, investment_account_id, title
    INTO _owner_type, _owner_user_id, _owner_family_id, _status, _quantity, _investment_account_id, _title
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

    PERFORM 1
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active
      AND account_kind = 'investment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active investment account is missing for portfolio position %', _position_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _close_currency_code = _base_currency_code THEN
        _effective_close_amount_in_base := round(_close_amount_in_currency, 2);
    ELSE
        IF _close_amount_in_base IS NULL OR _close_amount_in_base <= 0 THEN
            RAISE EXCEPTION 'Historical base amount is required for non-base currency close amount';
        END IF;

        _effective_close_amount_in_base := round(_close_amount_in_base, 2);
    END IF;

    _operation_comment := 'Закрытие позиции · ' || _title;
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
    VALUES (_operation_id, _investment_account_id, _close_currency_code, _close_amount_in_currency);

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        _close_currency_code,
        _close_amount_in_currency,
        _effective_close_amount_in_base
    );

    IF _close_currency_code <> _base_currency_code THEN
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
            _close_currency_code,
            _close_amount_in_currency,
            _close_amount_in_currency,
            _effective_close_amount_in_base / _close_amount_in_currency,
            _effective_close_amount_in_base,
            _effective_close_amount_in_base,
            _operation_id
        );
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
        linked_operation_id,
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
        _operation_id,
        NULLIF(btrim(_comment), ''),
        jsonb_build_object('amount_in_base', _effective_close_amount_in_base),
        _user_id
    );

    RETURN budgeting.get__portfolio_position(_user_id, _position_id);
END
$function$;
