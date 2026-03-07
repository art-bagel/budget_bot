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

    WITH balances AS (
        SELECT be.currency_code, sum(be.amount) AS amount
        FROM bank_entries be
        WHERE be.bank_account_id = _bank_account_id
        GROUP BY be.currency_code
    ),
    costs AS (
        SELECT fl.currency_code, sum(fl.cost_base_remaining) AS cost_base_remaining
        FROM fx_lots fl
        WHERE fl.bank_account_id = _bank_account_id
          AND fl.amount_remaining > 0
        GROUP BY fl.currency_code
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'currency_code', b.currency_code,
                'amount', b.amount,
                'historical_cost_in_base', CASE
                    WHEN b.currency_code = _base_currency_code THEN round(b.amount, 2)
                    ELSE COALESCE(c.cost_base_remaining, 0)
                END,
                'base_currency_code', _base_currency_code
            )
            ORDER BY b.currency_code
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM balances b
    LEFT JOIN costs c
      ON c.currency_code = b.currency_code
    WHERE b.amount <> 0;

    RETURN _result;
END
$function$;
