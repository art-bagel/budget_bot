-- Description:
--   Returns active or archived categories for a user.
-- Parameters:
--   _user_id bigint - Category owner.
--   _is_active boolean - Optional activity filter.
-- Returns:
--   jsonb - Array of categories.
CREATE OR REPLACE FUNCTION budgeting.get__categories(
    _user_id bigint,
    _is_active boolean DEFAULT NULL
)
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
                'id', c.id,
                'name', c.name,
                'kind', c.kind,
                'is_active', c.is_active,
                'created_at', c.created_at
            )
            ORDER BY c.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM categories c
    WHERE c.user_id = _user_id
      AND (_is_active IS NULL OR c.is_active = _is_active);

    RETURN _result;
END
$function$;
