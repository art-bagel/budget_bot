-- Description:
--   Returns budget balances by category in the user's base currency.
-- Parameters:
--   _user_id bigint - Budget owner.
--   _is_active boolean - Optional category activity filter.
-- Returns:
--   jsonb - Array of category balances.
CREATE OR REPLACE FUNCTION budgeting.get__budget_snapshot(
    _user_id bigint,
    _is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    WITH balances AS (
        SELECT be.category_id, sum(be.amount) AS amount
        FROM budget_entries be
        WHERE be.currency_code = _base_currency_code
        GROUP BY be.category_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category_id', c.id,
                'name', c.name,
                'kind', c.kind,
                'balance', COALESCE(b.amount, 0),
                'currency_code', _base_currency_code
            )
            ORDER BY c.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM categories c
    LEFT JOIN balances b
      ON b.category_id = c.id
    WHERE c.user_id = _user_id
      AND (_is_active IS NULL OR c.is_active = _is_active);

    RETURN _result;
END
$function$;
