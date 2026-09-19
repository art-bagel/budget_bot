-- Description:
--   Resolves a session token hash to a user id, sliding the expiry forward.
--   Returns NULL for unknown and for expired sessions alike — the caller has
--   no business distinguishing the two.
--
--   Продление делается не чаще раза в час: иначе каждый запрос к API
--   превращался бы в запись в базу.
-- Parameters:
--   _token_hash bytea - sha256 of the session token.
--   _ttl_seconds integer - Lifetime the session is extended to.
-- Returns:
--   bigint - User identifier, or NULL when the session is invalid.
DROP FUNCTION IF EXISTS budgeting.get__session_user;
CREATE FUNCTION budgeting.get__session_user(
    _token_hash bytea,
    _ttl_seconds integer DEFAULT 7776000
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _user_id bigint;
    _last_seen_at timestamptz;
BEGIN
    SET search_path TO budgeting;

    SELECT user_id, last_seen_at
    INTO _user_id, _last_seen_at
    FROM sessions
    WHERE token_hash = _token_hash
      AND expires_at > current_timestamp;

    IF _user_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF _last_seen_at < current_timestamp - interval '1 hour' THEN
        UPDATE sessions
        SET last_seen_at = current_timestamp,
            expires_at = current_timestamp + make_interval(secs => _ttl_seconds)
        WHERE token_hash = _token_hash;
    END IF;

    RETURN _user_id;
END
$function$;
