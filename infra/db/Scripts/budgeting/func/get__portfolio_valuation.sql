-- Description:
--   Returns the current analytical valuation of bank balances in the requested target currency.
-- Parameters:
--   _user_id bigint - Bank owner.
--   _bank_account_id bigint - Bank account identifier.
--   _target_currency_code char(3) - Currency for the valuation report.
--   _as_of timestamptz - Optional upper bound for FX rates.
-- Returns:
--   jsonb - Valuation line items and the total amount in the target currency.
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
BEGIN
    SET search_path TO budgeting;

    PERFORM 1
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND user_id = _user_id
      AND is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown active bank account % for user %', _bank_account_id, _user_id;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _target_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown target currency: %', _target_currency_code;
    END IF;

    FOR _balance IN
        SELECT currency_code, sum(amount) AS amount
        FROM bank_entries
        WHERE bank_account_id = _bank_account_id
        GROUP BY currency_code
        HAVING sum(amount) <> 0
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
