-- Description:
--   Attaches a login method to an existing account, or updates the secret of a
--   login method the account already owns.
--
--   Важно: это всегда "добавить способ входа к аккаунту", никогда не "слить
--   два аккаунта". Если provider_uid уже принадлежит другому пользователю,
--   функция падает: два ledger-а автоматически объединить нельзя, и молчаливый
--   мерж здесь необратимо испортил бы данные.
-- Parameters:
--   _user_id bigint - Account the login method is attached to.
--   _provider varchar - Login provider: 'telegram' | 'password'.
--   _provider_uid varchar - Telegram user id or email.
--   _secret text - Password hash for 'password', NULL for 'telegram'.
-- Returns:
--   jsonb - Status ('created' | 'updated') and the resulting identity.
DROP FUNCTION IF EXISTS budgeting.put__auth_identity;
CREATE FUNCTION budgeting.put__auth_identity(
    _user_id bigint,
    _provider varchar,
    _provider_uid varchar,
    _secret text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_user_id bigint;
    _existing_uid varchar(200);
    _status text := 'created';
BEGIN
    SET search_path TO budgeting;

    PERFORM 1 FROM users WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', _user_id;
    END IF;

    -- Блокируем строку до принятия решения: иначе два параллельных
    -- запроса на привязку одного и того же uid оба увидят "свободно".
    SELECT user_id
    INTO _owner_user_id
    FROM auth_identities
    WHERE provider = _provider
      AND provider_uid = _provider_uid
    FOR UPDATE;

    IF _owner_user_id IS NOT NULL AND _owner_user_id <> _user_id THEN
        RAISE EXCEPTION 'Этот способ входа уже привязан к другому аккаунту';
    END IF;

    SELECT provider_uid
    INTO _existing_uid
    FROM auth_identities
    WHERE user_id = _user_id
      AND provider = _provider
    FOR UPDATE;

    IF _existing_uid IS NOT NULL THEN
        _status := 'updated';

        UPDATE auth_identities
        SET provider_uid = _provider_uid,
            secret = COALESCE(_secret, secret),
            failed_attempts = 0,
            locked_until = NULL
        WHERE user_id = _user_id
          AND provider = _provider;
    ELSE
        INSERT INTO auth_identities (provider, provider_uid, user_id, secret)
        VALUES (_provider, _provider_uid, _user_id, _secret);
    END IF;

    RETURN jsonb_build_object(
        'status', _status,
        'user_id', _user_id,
        'provider', _provider,
        'provider_uid', _provider_uid
    );
END
$function$;
