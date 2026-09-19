-- Description:
--   Lists active sessions for the "logins and devices" screen.
--
--   session_id — это hex от sha256 токена. Знание хэша не дает войти (для
--   входа нужен прообраз), а эндпоинт и так доступен только владельцу, зато
--   не приходится заводить отдельный суррогатный ключ ради отображения.
-- Parameters:
--   _user_id bigint - Account whose sessions are listed.
-- Returns:
--   jsonb - Array of sessions, freshest first.
DROP FUNCTION IF EXISTS budgeting.get__user_sessions;
CREATE FUNCTION budgeting.get__user_sessions(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(jsonb_agg(item ORDER BY item->>'last_seen_at' DESC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'session_id', encode(s.token_hash, 'hex'),
            'device', s.device,
            'created_at', s.created_at,
            'last_seen_at', s.last_seen_at,
            'expires_at', s.expires_at
        ) AS item
        FROM budgeting.sessions s
        WHERE s.user_id = _user_id
          AND s.expires_at > current_timestamp
    ) sessions
$function$;
