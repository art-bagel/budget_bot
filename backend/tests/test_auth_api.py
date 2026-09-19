"""
Сквозной тест аутентификации через HTTP.

Запуск (нужна поднятая dev-база и переменные окружения приложения):
    TELEGRAM_BOT_TOKEN=... SIGNUP_INVITE_CODE=... python -m backend.tests.test_auth_api

Проверяет то, что нельзя проверить на уровне SQL: закрытость регистрации,
неразличимость ошибок входа, блокировку перебора, живость и отзыв сессий,
привязку способов входа и изоляцию аккаунтов друг от друга.

Тест пишет в базу и удаляет созданные аккаунты за собой — гонять на dev.
"""

import hashlib
import hmac
import json
import os
import urllib.parse

os.environ.setdefault('TELEGRAM_BOT_TOKEN', 'test-bot-token')
os.environ.setdefault('SIGNUP_INVITE_CODE', 'test-invite')

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.config import settings  # noqa: E402
from backend.app.main import app  # noqa: E402


TG_USER_ID = 990000000002
TG_OTHER_ID = 990000000003
EMAIL = 'e2e@example.com'
LOCK_EMAIL = 'e2e-lock@example.com'
PASSWORD = 'correct horse battery'
INVITE = os.environ['SIGNUP_INVITE_CODE']


def telegram_init_data(user_id: int) -> str:
    """
    Собирает подписанный initData, как это делает Telegram WebApp.
    :param user_id: Идентификатор пользователя Telegram.
    :return: Строка initData с корректной подписью.
    """
    import time

    fields = {
        'auth_date': str(int(time.time())),
        'user': json.dumps({'id': user_id, 'first_name': 'E2E'}, separators=(',', ':')),
    }
    data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(fields.items()))
    secret = hmac.new(b'WebAppData', settings.telegram_bot_token.encode(), hashlib.sha256).digest()
    fields['hash'] = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(fields)


def delete_account(client: TestClient, headers: dict) -> None:
    """
    Удаляет аккаунт штатным двухшаговым путем.
    :param client: HTTP-клиент приложения.
    :param headers: Заголовки аутентификации владельца аккаунта.
    """
    request = client.post('/api/v1/auth/account/delete-request', headers=headers)

    if request.status_code != 200:
        return

    client.delete(
        '/api/v1/auth/account',
        params={'confirm_token': request.json()['confirm_token']},
        headers=headers,
    )


def cleanup(client: TestClient) -> None:
    """
    Удаляет аккаунты, созданные тестом, чтобы повторный прогон был чистым.
    :param client: HTTP-клиент приложения.
    """
    for user_id in (TG_USER_ID, TG_OTHER_ID):
        delete_account(client, {'X-Telegram-Init-Data': telegram_init_data(user_id)})

    for email in (EMAIL, LOCK_EMAIL, 'tg@example.com'):
        login = client.post('/api/v1/auth/login', json={'email': email, 'password': PASSWORD})
        if login.status_code == 200:
            delete_account(client, {'Authorization': 'Bearer ' + login.json()['token']})


def main() -> None:
    with TestClient(app) as client:
        cleanup(client)

        # 1. Регистрация по email закрыта без кода-приглашения.
        signup_body = {'email': EMAIL, 'password': PASSWORD, 'base_currency_code': 'RUB'}
        response = client.post('/api/v1/auth/signup', json=signup_body)
        assert response.status_code == 403, response.text
        response = client.post('/api/v1/auth/signup', json={**signup_body, 'invite_code': 'мимо'})
        assert response.status_code == 403, response.text

        # Короткий пароль не принимается.
        response = client.post(
            '/api/v1/auth/signup',
            json={**signup_body, 'password': 'short', 'invite_code': INVITE},
        )
        assert response.status_code == 422, response.text

        # 2. Регистрация с кодом выдает рабочую сессию.
        response = client.post('/api/v1/auth/signup', json={**signup_body, 'invite_code': INVITE})
        assert response.status_code == 200, response.text
        email_user_id = response.json()['user_id']
        token = response.json()['token']
        auth_headers = {'Authorization': 'Bearer ' + token}

        assert email_user_id >= 9007199254740992, 'локальный id вне диапазона telegram'

        # Повторная регистрация на тот же email не проходит.
        response = client.post('/api/v1/auth/signup', json={**signup_body, 'invite_code': INVITE})
        assert response.status_code == 409, response.text

        # 3. Сессия пускает, мусорный токен — нет.
        assert client.get('/api/v1/auth/methods', headers=auth_headers).status_code == 200
        assert client.get('/api/v1/auth/methods').status_code == 401
        assert client.get(
            '/api/v1/auth/methods',
            headers={'Authorization': 'Bearer not-a-real-token'},
        ).status_code == 401
        assert client.get(
            '/api/v1/auth/methods',
            headers={'Authorization': token},
        ).status_code == 401, 'схема Bearer обязательна'

        # 4. Неизвестный email и неверный пароль отвечают одинаково.
        wrong = client.post('/api/v1/auth/login', json={'email': EMAIL, 'password': 'не тот пароль'})
        unknown = client.post('/api/v1/auth/login', json={'email': 'нет@example.com', 'password': PASSWORD})
        assert wrong.status_code == unknown.status_code == 401, (wrong.text, unknown.text)
        assert wrong.json()['detail'] == unknown.json()['detail'], 'ответы не должны различаться'

        # 5. Серия неудач блокирует перебор — на отдельном аккаунте, чтобы
        #    основной остался пригодным для остального сценария.
        response = client.post(
            '/api/v1/auth/signup',
            json={'email': LOCK_EMAIL, 'password': PASSWORD, 'base_currency_code': 'RUB', 'invite_code': INVITE},
        )
        assert response.status_code == 200, response.text
        lock_headers = {'Authorization': 'Bearer ' + response.json()['token']}

        for _ in range(5):
            client.post('/api/v1/auth/login', json={'email': LOCK_EMAIL, 'password': 'не тот пароль'})

        blocked = client.post('/api/v1/auth/login', json={'email': LOCK_EMAIL, 'password': PASSWORD})
        assert blocked.status_code == 429, blocked.text

        # Блокировка закрывает вход, но не выбивает уже открытые сессии.
        assert client.get('/api/v1/auth/methods', headers=lock_headers).status_code == 200
        delete_account(client, lock_headers)

        response = client.post('/api/v1/auth/login', json={'email': EMAIL, 'password': PASSWORD, 'device': 'iPhone'})
        assert response.status_code == 200, response.text
        second_token = response.json()['token']

        # 6. Обе сессии видны, текущая помечена.
        sessions = client.get('/api/v1/auth/sessions', headers=auth_headers).json()
        assert len(sessions) == 2, sessions
        assert sum(session['is_current'] for session in sessions) == 1, sessions
        assert any(session['device'] == 'iPhone' for session in sessions), sessions

        # Отзыв чужой сессии с этого устройства.
        other = next(session for session in sessions if not session['is_current'])
        revoked = client.delete('/api/v1/auth/sessions/' + other['session_id'], headers=auth_headers)
        assert revoked.status_code == 200 and revoked.json()['revoked'] == 1, revoked.text
        assert client.get(
            '/api/v1/auth/methods',
            headers={'Authorization': 'Bearer ' + second_token},
        ).status_code == 401, 'отозванная сессия не должна пускать'

        # 7. Telegram-регистрация — отдельный аккаунт под своим id.
        tg_headers = {'X-Telegram-Init-Data': telegram_init_data(TG_USER_ID)}
        response = client.post('/api/v1/auth/register', json={'base_currency_code': 'RUB'}, headers=tg_headers)
        assert response.status_code == 200, response.text
        tg_user_id = response.json()['user_id']
        assert tg_user_id == TG_USER_ID

        methods = client.get('/api/v1/auth/methods', headers=tg_headers).json()
        assert [method['provider'] for method in methods] == ['telegram'], methods

        # 8. Telegram-аккаунт добавляет себе вход по паролю.
        response = client.post(
            '/api/v1/auth/password',
            json={'email': 'tg@example.com', 'new_password': PASSWORD},
            headers=tg_headers,
        )
        assert response.status_code == 200, response.text
        response = client.post('/api/v1/auth/login', json={'email': 'tg@example.com', 'password': PASSWORD})
        assert response.status_code == 200, response.text
        assert response.json()['user_id'] == tg_user_id, 'пароль ведет в тот же аккаунт'
        tg_session_headers = {'Authorization': 'Bearer ' + response.json()['token']}

        # Смена пароля требует текущего.
        response = client.post(
            '/api/v1/auth/password',
            json={'email': 'tg@example.com', 'new_password': PASSWORD + '!'},
            headers=tg_session_headers,
        )
        assert response.status_code == 403, response.text

        # 9. Главный guard: чужой Telegram нельзя привязать к своему аккаунту.
        response = client.post(
            '/api/v1/auth/telegram/link',
            headers={**auth_headers, 'X-Telegram-Init-Data': telegram_init_data(TG_USER_ID)},
        )
        assert response.status_code == 400, response.text
        assert 'другому аккаунту' in response.text, response.text

        # Свободный Telegram привязывается к email-аккаунту.
        response = client.post(
            '/api/v1/auth/telegram/link',
            headers={**auth_headers, 'X-Telegram-Init-Data': telegram_init_data(TG_OTHER_ID)},
        )
        assert response.status_code == 200, response.text

        # И теперь вход из этого Telegram ведет в email-аккаунт, а не заводит новый.
        methods = client.get(
            '/api/v1/auth/methods',
            headers={'X-Telegram-Init-Data': telegram_init_data(TG_OTHER_ID)},
        ).json()
        assert {method['provider'] for method in methods} == {'telegram', 'password'}, methods

        # 10. Выход убивает текущую сессию.
        assert client.post('/api/v1/auth/logout', headers=auth_headers).status_code == 200
        assert client.get('/api/v1/auth/methods', headers=auth_headers).status_code == 401

        # 11. Неизвестный Telegram аутентифицирован, но аккаунта не имеет.
        response = client.get(
            '/api/v1/auth/methods',
            headers={'X-Telegram-Init-Data': telegram_init_data(990000000009)},
        )
        assert response.status_code == 401, response.text

        # Подделанная подпись не проходит.
        assert client.get(
            '/api/v1/auth/methods',
            headers={'X-Telegram-Init-Data': telegram_init_data(TG_USER_ID)[:-1] + '0'},
        ).status_code == 401

        cleanup(client)
        print('auth api: все проверки пройдены')


if __name__ == '__main__':
    main()
