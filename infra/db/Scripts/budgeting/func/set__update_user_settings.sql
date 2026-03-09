-- Description:
--   Updates user interface settings.
-- Parameters:
--   _user_id bigint - User identifier.
--   _hints_enabled boolean - Whether to show gesture hints (NULL = no change).
--   _theme varchar - Theme preference: 'light', 'dark', 'system' (NULL = no change).
-- Returns:
--   jsonb - Updated settings.
CREATE OR REPLACE FUNCTION budgeting.set__update_user_settings(
    _user_id bigint,
    _hints_enabled boolean DEFAULT NULL,
    _theme varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_hints_enabled boolean;
    v_theme varchar;
BEGIN
    SET search_path TO budgeting;

    UPDATE users
    SET
        hints_enabled = COALESCE(_hints_enabled, hints_enabled),
        theme         = COALESCE(_theme, theme)
    WHERE id = _user_id
    RETURNING hints_enabled, theme INTO v_hints_enabled, v_theme;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', _user_id;
    END IF;

    RETURN jsonb_build_object(
        'hints_enabled', v_hints_enabled,
        'theme', v_theme
    );
END
$function$;
