-- Description:
--   Records the outcome of a login attempt. A successful attempt clears the
--   failure counter; consecutive failures lock the login method for a while,
--   so that a password cannot be brute-forced.
-- Parameters:
--   _provider varchar - Login provider.
--   _provider_uid varchar - Telegram user id or email.
--   _success boolean - Whether the credentials were correct.
--   _max_attempts smallint - Failures before the lockout kicks in.
--   _lock_seconds integer - Lockout duration.
-- Returns:
--   jsonb - Resulting failure counter and lockout state.
DROP FUNCTION IF EXISTS budgeting.set__auth_login_result;
CREATE FUNCTION budgeting.set__auth_login_result(
    _provider varchar,
    _provider_uid varchar,
    _success boolean,
    _max_attempts smallint DEFAULT 5,
    _lock_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_failed_attempts smallint;
    v_locked_until timestamptz;
BEGIN
    SET search_path TO budgeting;

    -- Счетчик и решение о блокировке считаются внутри одного UPDATE,
    -- поэтому отдельный FOR UPDATE не нужен: строка блокируется самим UPDATE.
    UPDATE auth_identities
    SET failed_attempts = CASE WHEN _success THEN 0 ELSE failed_attempts + 1 END,
        locked_until = CASE
            WHEN _success THEN NULL
            WHEN failed_attempts + 1 >= _max_attempts
                THEN current_timestamp + make_interval(secs => _lock_seconds)
            ELSE locked_until
        END
    WHERE provider = _provider
      AND provider_uid = _provider_uid
    RETURNING failed_attempts, locked_until
    INTO v_failed_attempts, v_locked_until;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'failed_attempts', v_failed_attempts,
        'locked_until', v_locked_until,
        'is_locked', v_locked_until IS NOT NULL AND v_locked_until > current_timestamp
    );
END
$function$;
