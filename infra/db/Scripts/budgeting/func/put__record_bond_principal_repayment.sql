CREATE OR REPLACE FUNCTION budgeting.put__record_bond_principal_repayment(
    _user_id bigint,
    _position_id bigint,
    _return_amount_in_currency numeric,
    _currency_code char(3),
    _principal_reduction_in_currency numeric,
    _repaid_at date,
    _external_id text,
    _import_source varchar(30),
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
    _current_amount_in_currency numeric(20, 8);
    _current_amount_in_base numeric(20, 2);
    _current_clean_amount_in_base numeric(20, 2);
    _current_returned_amount_in_base numeric(20, 2);
    _investment_account_id bigint;
    _title text;
    _base_currency_code char(3);
    _effective_return_amount_in_base numeric(20, 2);
    _released_principal_in_base numeric(20, 2);
    _released_clean_principal_in_base numeric(20, 2);
    _remaining_amount_in_base numeric(20, 2);
    _remaining_clean_amount_in_base numeric(20, 2);
    _next_returned_amount_in_base numeric(20, 2);
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT
        owner_type,
        owner_user_id,
        owner_family_id,
        status,
        amount_in_currency,
        COALESCE((metadata ->> 'amount_in_base')::numeric, 0),
        (metadata ->> 'clean_amount_in_base')::numeric,
        COALESCE((metadata ->> 'returned_amount_in_base')::numeric, 0),
        investment_account_id,
        title
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _status,
        _current_amount_in_currency,
        _current_amount_in_base,
        _current_clean_amount_in_base,
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
        RAISE EXCEPTION 'Portfolio position % must be open for bond repayment', _position_id;
    END IF;

    IF _principal_reduction_in_currency <= 0 OR _principal_reduction_in_currency >= _current_amount_in_currency THEN
        RAISE EXCEPTION
            'Bond repayment must leave a positive remaining principal; use full repayment for final close';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);
    IF upper(_currency_code) <> _base_currency_code THEN
        RAISE EXCEPTION 'Non-base currency bond repayment is not supported yet';
    END IF;

    _effective_return_amount_in_base := round(_return_amount_in_currency, 2);
    _released_principal_in_base := round(
        _current_amount_in_base * _principal_reduction_in_currency / _current_amount_in_currency,
        2
    );
    _remaining_amount_in_base := _current_amount_in_base - _released_principal_in_base;

    IF _current_clean_amount_in_base IS NOT NULL THEN
        _released_clean_principal_in_base := round(
            _current_clean_amount_in_base * _principal_reduction_in_currency / _current_amount_in_currency,
            2
        );
        _remaining_clean_amount_in_base := _current_clean_amount_in_base - _released_clean_principal_in_base;
    ELSE
        _remaining_clean_amount_in_base := NULL;
    END IF;

    _next_returned_amount_in_base := _current_returned_amount_in_base + _effective_return_amount_in_base;

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
        COALESCE(_comment, 'Погашение облигации · ' || _title)
    )
    RETURNING id INTO _operation_id;

    INSERT INTO bank_entries (
        operation_id,
        bank_account_id,
        currency_code,
        amount,
        external_id,
        import_source
    )
    VALUES (
        _operation_id,
        _investment_account_id,
        upper(_currency_code),
        _return_amount_in_currency,
        _external_id,
        _import_source
    );

    PERFORM budgeting.put__apply_current_bank_delta(
        _investment_account_id,
        upper(_currency_code),
        _return_amount_in_currency,
        _released_principal_in_base
    );

    UPDATE portfolio_positions
    SET amount_in_currency = amount_in_currency - _principal_reduction_in_currency,
        metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object(
                       'amount_in_base', _remaining_amount_in_base,
                       'returned_amount_in_base', _next_returned_amount_in_base
                   )
                   || CASE
                        WHEN _remaining_clean_amount_in_base IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('clean_amount_in_base', _remaining_clean_amount_in_base)
                      END
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
        created_by_user_id,
        external_id,
        import_source
    )
    VALUES (
        _position_id,
        'adjustment',
        COALESCE(_repaid_at, CURRENT_DATE),
        _return_amount_in_currency,
        upper(_currency_code),
        _operation_id,
        COALESCE(_comment, 'Погашение облигации · ' || _title),
        jsonb_build_object(
            'action', 'bond_repayment',
            'amount_in_base', _effective_return_amount_in_base,
            'principal_amount_in_currency', _principal_reduction_in_currency,
            'principal_amount_in_base', _released_principal_in_base
        ),
        _user_id,
        _external_id,
        _import_source
    );

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'released_principal_in_base', _released_principal_in_base
    );
END
$function$;
