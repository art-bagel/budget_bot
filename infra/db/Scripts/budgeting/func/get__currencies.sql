-- Description:
--   Returns all available currencies.
-- Returns:
--   jsonb - Array of currency objects (code, name, scale).
DROP FUNCTION IF EXISTS budgeting.get__currencies;
CREATE FUNCTION budgeting.get__currencies()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'code', c.code,
                'name', c.name,
                'scale', c.scale
            )
            ORDER BY c.code
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM currencies c;

    RETURN _result;
END
$function$;
