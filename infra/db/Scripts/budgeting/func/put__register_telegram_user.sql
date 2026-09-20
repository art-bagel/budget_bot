-- Description:
--   Finds the account behind a Telegram login, or creates one when there is none.
--
--   Идентификатор аккаунта больше не равен telegram id: новый аккаунт получает
--   id из users_local_id_seq, а telegram живёт в auth_identities как обычный
--   провайдер. Исторические аккаунты, где числа совпадают, не трогаются —
--   совпадение осталось историческим и ни на что не влияет.
-- Parameters:
--   _telegram_id bigint - Telegram user id.
--   _base_currency_code char(3) - Base currency for a freshly created account.
--   _username text - Telegram username, if known.
--   _first_name text - Telegram first name, if known.
--   _last_name text - Telegram last name, if known.
-- Returns:
--   jsonb - Startup context of the existing or newly created account.
DROP FUNCTION IF EXISTS budgeting.put__register_telegram_user;
CREATE FUNCTION budgeting.put__register_telegram_user(
    _telegram_id bigint,
    _base_currency_code char(3),
    _username text DEFAULT NULL,
    _first_name text DEFAULT NULL,
    _last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _user_id bigint;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    -- Сериализуем регистрацию по одному telegram id: без этого два
    -- параллельных запроса оба увидят "входа нет" и создадут два аккаунта.
    -- Коллизии с блокировкой по users.id в put__register_user_context нет:
    -- telegram id < 2^52, а локальные id начинаются с 2^53.
    PERFORM pg_advisory_xact_lock(_telegram_id);

    SELECT ai.user_id
    INTO _user_id
    FROM auth_identities ai
    WHERE ai.provider = 'telegram'
      AND ai.provider_uid = _telegram_id::text;

    IF _user_id IS NOT NULL THEN
        UPDATE users
        SET username = COALESCE(_username, username),
            first_name = COALESCE(_first_name, first_name),
            last_name = COALESCE(_last_name, last_name)
        WHERE id = _user_id;

        RETURN get__user_context(_user_id);
    END IF;

    _result := put__register_user_context(
        NULL,
        _base_currency_code,
        _username,
        _first_name,
        _last_name
    );
    _user_id := (_result->>'user_id')::bigint;

    INSERT INTO auth_identities (provider, provider_uid, user_id)
    VALUES ('telegram', _telegram_id::text, _user_id);

    RETURN _result;
END
$function$;
