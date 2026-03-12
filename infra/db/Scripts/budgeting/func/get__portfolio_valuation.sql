CREATE OR REPLACE FUNCTION budgeting.get__portfolio_valuation(
    _user_id bigint,
    _bank_account_id bigint,
    _target_currency_code char(3),
    _as_of timestamptz DEFAULT current_timestamp
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result_items jsonb := '[]'::jsonb;
    _total_value numeric(20, 2) := 0;
    _line_value numeric(20, 2);
    _rate numeric(20, 8);
    _balance record;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _target_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown target currency: %', _target_currency_code;
    END IF;

    FOR _balance IN
        SELECT currency_code, amount
        FROM current_bank_balances
        WHERE bank_account_id = _bank_account_id
          AND amount <> 0
        ORDER BY currency_code
    LOOP
        IF _balance.currency_code = _target_currency_code THEN
            _rate := 1;
        ELSE
            SELECT rate
            INTO _rate
            FROM fx_rate_snapshots
            WHERE base_currency_code = _target_currency_code
              AND quote_currency_code = _balance.currency_code
              AND fetched_at <= _as_of
            ORDER BY fetched_at DESC
            LIMIT 1;

            IF _rate IS NULL THEN
                RAISE EXCEPTION 'Missing FX rate from % to % at %',
                    _balance.currency_code,
                    _target_currency_code,
                    _as_of;
            END IF;
        END IF;

        _line_value := round(_balance.amount * _rate, 2);
        _total_value := _total_value + _line_value;
        _result_items := _result_items || jsonb_build_array(
            jsonb_build_object(
                'currency_code', _balance.currency_code,
                'amount', _balance.amount,
                'rate_to_target', _rate,
                'value_in_target', _line_value
            )
        );
    END LOOP;

    RETURN jsonb_build_object(
        'target_currency_code', _target_currency_code,
        'as_of', _as_of,
        'total_value', _total_value,
        'items', _result_items
    );
END
$function$;
