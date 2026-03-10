-- Description:
--   Returns bank balances by currency together with historical cost in the user's base currency.
-- Parameters:
--   _user_id bigint - Bank owner.
--   _bank_account_id bigint - Bank account identifier.
-- Returns:
--   jsonb - Array of currency balances.
CREATE OR REPLACE FUNCTION budgeting.get__bank_snapshot(
    _user_id bigint,
    _bank_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT u.base_currency_code
    INTO _base_currency_code
    FROM users u
    JOIN bank_accounts ba
      ON ba.user_id = u.id
    WHERE u.id = _user_id
      AND ba.id = _bank_account_id
      AND ba.is_active;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account % for user %', _bank_account_id, _user_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'currency_code', cbb.currency_code,
                'amount', cbb.amount,
                'historical_cost_in_base', cbb.historical_cost_in_base,
                'base_currency_code', _base_currency_code
            )
            ORDER BY cbb.currency_code
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM current_bank_balances cbb
    WHERE cbb.bank_account_id = _bank_account_id
      AND cbb.amount <> 0;

    RETURN _result;
END
$function$;
