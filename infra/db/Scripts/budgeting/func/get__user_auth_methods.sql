-- Description:
--   Lists the login methods attached to an account, for the settings screen.
--   Секрет наружу не отдается — только факт наличия пароля.
-- Parameters:
--   _user_id bigint - Account identifier.
-- Returns:
--   jsonb - Array of login methods, oldest first.
DROP FUNCTION IF EXISTS budgeting.get__user_auth_methods;
CREATE FUNCTION budgeting.get__user_auth_methods(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at'), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'provider', ai.provider,
            'provider_uid', ai.provider_uid,
            'has_secret', ai.secret IS NOT NULL,
            'created_at', ai.created_at
        ) AS item
        FROM budgeting.auth_identities ai
        WHERE ai.user_id = _user_id
    ) methods
$function$;
