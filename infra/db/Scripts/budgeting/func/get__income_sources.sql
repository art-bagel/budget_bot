-- Description:
--   Returns active or archived income sources for a user.
-- Parameters:
--   _user_id bigint - Income source owner.
--   _is_active boolean - Optional activity filter.
-- Returns:
--   jsonb - Array of income sources.
CREATE OR REPLACE FUNCTION budgeting.get__income_sources(
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
                'id', ins.id,
                'name', ins.name,
                'is_active', ins.is_active,
                'created_at', ins.created_at
            )
            ORDER BY ins.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM income_sources ins
    WHERE ins.user_id = _user_id
      AND (_is_active IS NULL OR ins.is_active = _is_active);

    RETURN _result;
END
$function$;
