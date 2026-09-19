-- Description:
--   Opens a client session. Only the sha256 of the token is stored, so a dump
--   of this table does not let anyone log in.
-- Parameters:
--   _user_id bigint - Account the session belongs to.
--   _token_hash bytea - sha256 of the session token.
--   _device varchar - Human readable device label for the sessions screen.
--   _ttl_seconds integer - Session lifetime.
-- Returns:
--   jsonb - Session expiry.
DROP FUNCTION IF EXISTS budgeting.put__session;
CREATE FUNCTION budgeting.put__session(
    _user_id bigint,
    _token_hash bytea,
    _device varchar DEFAULT NULL,
    _ttl_seconds integer DEFAULT 7776000
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _expires_at timestamptz;
BEGIN
    SET search_path TO budgeting;

    PERFORM 1 FROM users WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', _user_id;
    END IF;

    -- Попутная уборка протухших сессий этого пользователя: дешевле, чем
    -- заводить отдельную фоновую задачу ради пары строк.
    DELETE FROM sessions
    WHERE user_id = _user_id
      AND expires_at <= current_timestamp;

    INSERT INTO sessions (token_hash, user_id, device, expires_at)
    VALUES (
        _token_hash,
        _user_id,
        _device,
        current_timestamp + make_interval(secs => _ttl_seconds)
    )
    RETURNING expires_at INTO _expires_at;

    RETURN jsonb_build_object(
        'user_id', _user_id,
        'expires_at', _expires_at
    );
END
$function$;
