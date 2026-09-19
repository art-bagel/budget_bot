-- Сценарный тест слоя аутентификации.
--
-- Запуск на локальном docker-стеке:
--   docker exec budget_bot_db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
--       -d "$POSTGRES_DB" -f /Scripts/budgeting/tests/auth.sql'
--
-- Падает, если ломается хоть одно из поведений: изоляция аккаунтов при
-- привязке способа входа, блокировка после серии неудачных паролей, срок
-- жизни и отзыв сессий. Тест пишет в базу — гонять на dev, не на проде.
-- Созданные им аккаунты удаляются в конце.
SET search_path TO budgeting;

DO $$
DECLARE
    _tg_user_id bigint;
    _email_user_id bigint;
    _identity jsonb;
    _result jsonb;
    _sessions jsonb;
    _resolved bigint;
    _guard_fired boolean := false;
    _token_a bytea := sha256('token-a'::bytea);
    _token_b bytea := sha256('token-b'::bytea);
    _tg_uid text := '990000000001';
BEGIN
    INSERT INTO currencies (code, name) VALUES ('RUB', 'Российский рубль')
    ON CONFLICT (code) DO NOTHING;

    -- 1. Telegram-регистрация: идентификатор приходит снаружи, как раньше.
    _result := put__register_user_context(_tg_uid::bigint, 'RUB', NULL, 'TG', 'User');
    _tg_user_id := (_result->>'user_id')::bigint;
    ASSERT _tg_user_id = _tg_uid::bigint, 'telegram id должен становиться users.id';

    _result := put__auth_identity(_tg_user_id, 'telegram', _tg_uid);
    ASSERT _result->>'status' = 'created', 'привязка telegram-входа';

    _identity := get__auth_identity('telegram', _tg_uid);
    ASSERT (_identity->>'user_id')::bigint = _tg_user_id, 'поиск по telegram-входу';
    ASSERT NOT (_identity->>'is_locked')::boolean, 'свежий вход не заблокирован';

    ASSERT get__auth_identity('telegram', 'нет-такого') IS NULL,
        'несуществующий вход возвращает NULL';

    -- 2. Регистрация по email: идентификатор выдает последовательность.
    _result := put__register_user_context(NULL, 'RUB', NULL, 'Email', 'User');
    _email_user_id := (_result->>'user_id')::bigint;
    ASSERT _email_user_id >= 9007199254740992,
        'локальный id должен лежать выше диапазона telegram id';

    _result := put__auth_identity(_email_user_id, 'password', 'a@example.com', 'hash-1');
    ASSERT _result->>'status' = 'created', 'привязка пароля';

    -- 3. Главный guard: чужой способ входа нельзя перевесить на свой аккаунт.
    BEGIN
        PERFORM put__auth_identity(_tg_user_id, 'password', 'a@example.com', 'hash-2');
    EXCEPTION WHEN raise_exception THEN
        _guard_fired := true;
    END;
    ASSERT _guard_fired, 'привязка чужого email обязана падать, а не сливать аккаунты';

    ASSERT (get__auth_identity('password', 'a@example.com')->>'user_id')::bigint = _email_user_id,
        'после неудачной попытки владелец входа не меняется';

    -- Смена email у своего же аккаунта — это update, а не второй вход.
    _result := put__auth_identity(_email_user_id, 'password', 'b@example.com', 'hash-1');
    ASSERT _result->>'status' = 'updated', 'смена email обновляет существующий вход';
    ASSERT get__auth_identity('password', 'a@example.com') IS NULL, 'старый email освобожден';

    -- 4. Блокировка после серии неудачных паролей.
    FOR i IN 1..4 LOOP
        _result := set__auth_login_result('password', 'b@example.com', false, 5::smallint, 900);
    END LOOP;
    ASSERT (_result->>'failed_attempts')::int = 4, 'счетчик неудач растет';
    ASSERT NOT (_result->>'is_locked')::boolean, 'до порога блокировки нет';

    _result := set__auth_login_result('password', 'b@example.com', false, 5::smallint, 900);
    ASSERT (_result->>'is_locked')::boolean, 'на пятой неудаче вход блокируется';
    ASSERT (get__auth_identity('password', 'b@example.com')->>'is_locked')::boolean,
        'блокировка видна при следующем поиске';

    _result := set__auth_login_result('password', 'b@example.com', true, 5::smallint, 900);
    ASSERT NOT (_result->>'is_locked')::boolean, 'успешный вход снимает блокировку';
    ASSERT (_result->>'failed_attempts')::int = 0, 'успешный вход обнуляет счетчик';

    -- 5. Сессии.
    PERFORM put__session(_email_user_id, _token_a, 'iPhone', 7776000);
    PERFORM put__session(_email_user_id, _token_b, 'Web', 7776000);

    ASSERT get__session_user(_token_a) = _email_user_id, 'валидный токен резолвится';
    ASSERT get__session_user(sha256('неизвестный'::bytea)) IS NULL,
        'неизвестный токен не резолвится';

    _sessions := get__user_sessions(_email_user_id);
    ASSERT jsonb_array_length(_sessions) = 2, 'обе сессии видны на экране устройств';
    ASSERT NOT (_sessions::text LIKE '%token_hash%'), 'хэш токена не утекает в список';

    -- Протухшая сессия не пускает.
    PERFORM put__session(_tg_user_id, sha256('протухший'::bytea), 'Old', -10);
    ASSERT get__session_user(sha256('протухший'::bytea)) IS NULL,
        'истекшая сессия не резолвится';
    ASSERT jsonb_array_length(get__user_sessions(_tg_user_id)) = 0,
        'истекшая сессия не показывается в списке';

    -- Отзыв всех, кроме текущей (сценарий смены пароля).
    _result := set__revoke_sessions(_email_user_id, NULL, _token_a);
    ASSERT (_result->>'revoked')::int = 1, 'отозвана ровно одна чужая сессия';
    ASSERT get__session_user(_token_a) = _email_user_id, 'текущая сессия выжила';
    ASSERT get__session_user(_token_b) IS NULL, 'остальные отозваны';

    -- Нельзя отозвать сессию другого пользователя.
    PERFORM put__session(_tg_user_id, sha256('чужая'::bytea), 'Other', 7776000);
    _result := set__revoke_sessions(_email_user_id, sha256('чужая'::bytea));
    ASSERT (_result->>'revoked')::int = 0, 'чужая сессия не отзывается';
    ASSERT get__session_user(sha256('чужая'::bytea)) = _tg_user_id, 'чужая сессия цела';

    -- 6. Штатное удаление аккаунта уносит за собой входы и сессии —
    --    через ON DELETE CASCADE, без правок в set__delete_user_account.
    PERFORM set__delete_user_account(_email_user_id);
    ASSERT get__auth_identity('password', 'b@example.com') IS NULL,
        'входы удаляются вместе с аккаунтом';
    ASSERT get__session_user(_token_a) IS NULL,
        'сессии удаляются вместе с аккаунтом';

    PERFORM set__delete_user_account(_tg_user_id);

    RAISE NOTICE 'auth: все проверки пройдены';
END
$$;
