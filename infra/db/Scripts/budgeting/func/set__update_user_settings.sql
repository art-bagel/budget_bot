-- Description:
--   Updates user interface settings.
-- Parameters:
--   _user_id bigint - User identifier.
--   _hints_enabled boolean - Whether to show gesture hints.
-- Returns:
--   jsonb - Updated settings.
CREATE OR REPLACE FUNCTION budgeting.set__update_user_settings(
    _user_id bigint,
    _hints_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE users
    SET hints_enabled = _hints_enabled
    WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', _user_id;
    END IF;

    RETURN jsonb_build_object(
        'hints_enabled', _hints_enabled
    );
END
$function$;
