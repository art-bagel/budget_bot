-- Description:
--   Revokes sessions of a single account. Everything is scoped by _user_id,
--   so a caller can never drop somebody else's session.
--
--   Три режима: конкретная сессия (выход с устройства), все кроме текущей
--   (смена пароля), все подряд (выход везде).
-- Parameters:
--   _user_id bigint - Account whose sessions are revoked.
--   _token_hash bytea - Revoke exactly this session, when given.
--   _except_token_hash bytea - Revoke everything but this session, when given.
-- Returns:
--   jsonb - Number of revoked sessions.
DROP FUNCTION IF EXISTS budgeting.set__revoke_sessions;
CREATE FUNCTION budgeting.set__revoke_sessions(
    _user_id bigint,
    _token_hash bytea DEFAULT NULL,
    _except_token_hash bytea DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _revoked integer;
BEGIN
    SET search_path TO budgeting;

    DELETE FROM sessions
    WHERE user_id = _user_id
      AND (_token_hash IS NULL OR token_hash = _token_hash)
      AND (_except_token_hash IS NULL OR token_hash <> _except_token_hash);

    GET DIAGNOSTICS _revoked = ROW_COUNT;

    RETURN jsonb_build_object('revoked', _revoked);
END
$function$;
