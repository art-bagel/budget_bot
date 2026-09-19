-- Description:
--   Returns the login method by provider and provider uid, together with the
--   password secret and the current lockout state. Used by the login flow.
-- Parameters:
--   _provider varchar - Login provider: 'telegram' | 'password'.
--   _provider_uid varchar - Telegram user id or email, depending on provider.
-- Returns:
--   jsonb - Identity payload, or NULL when no such login method exists.
DROP FUNCTION IF EXISTS budgeting.get__auth_identity;
CREATE FUNCTION budgeting.get__auth_identity(
    _provider varchar,
    _provider_uid varchar
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT jsonb_build_object(
        'user_id', ai.user_id,
        'provider', ai.provider,
        'provider_uid', ai.provider_uid,
        'secret', ai.secret,
        'failed_attempts', ai.failed_attempts,
        'is_locked', ai.locked_until IS NOT NULL AND ai.locked_until > current_timestamp,
        'locked_until', ai.locked_until
    )
    FROM budgeting.auth_identities ai
    WHERE ai.provider = _provider
      AND ai.provider_uid = _provider_uid
$function$;
