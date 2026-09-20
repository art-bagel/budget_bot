from dataclasses import dataclass
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException

from backend.app.config import settings
from backend.app.storage import auth


PROVIDER_TELEGRAM = 'telegram'
PROVIDER_PASSWORD = 'password'


@dataclass
class AuthPrincipal:
    """
    Кто аутентифицирован — до того, как это связано с аккаунтом.

    Telegram-пользователь может быть аутентифицирован, но еще не иметь
    аккаунта: именно это состояние обслуживает регистрация.
    """

    telegram_id: Optional[int] = None
    session_user_id: Optional[int] = None
    session_token_hash: Optional[bytes] = None
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


@dataclass
class CurrentUser:
    """
    Аутентифицированный владелец существующего аккаунта.

    Имя и username сюда не переносятся: они есть в users и нужны только при
    регистрации, где берутся из AuthPrincipal.
    """

    user_id: int
    # Нужен, чтобы отозвать все сессии кроме текущей и отметить ее в списке.
    session_token_hash: Optional[bytes] = None


def new_session_token() -> str:
    """
    Генерирует токен сессии.
    :return: Случайный токен, который отдается клиенту и больше нигде не хранится.
    """
    return secrets.token_urlsafe(32)


def session_token_hash(token: str) -> bytes:
    """
    Считает хэш токена сессии для хранения и поиска.
    :param token: Токен сессии в открытом виде.
    :return: sha256 от токена.
    """
    return hashlib.sha256(token.encode('utf-8')).digest()


def parse_telegram_init_data(init_data_raw: str) -> dict:
    """
    Проверяет подпись Telegram WebApp initData и разбирает полезную нагрузку.
    :param init_data_raw: Значение заголовка X-Telegram-Init-Data.
    :return: Словарь с данными пользователя Telegram.
    """
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=500, detail='Telegram bot token is not configured on the server')

    try:
        pairs = parse_qsl(init_data_raw, keep_blank_values=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid Telegram init data format') from exc

    init_data = dict(pairs)
    received_hash = init_data.pop('hash', None)

    if not received_hash:
        raise HTTPException(status_code=401, detail='Missing Telegram hash')

    data_check_string = '\n'.join(
        f'{key}={value}'
        for key, value in sorted(init_data.items())
    )
    secret_key = hmac.new(
        b'WebAppData',
        settings.telegram_bot_token.encode(),
        hashlib.sha256,
    ).digest()
    calculated_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise HTTPException(status_code=401, detail='Invalid Telegram signature')

    auth_date = init_data.get('auth_date')

    if settings.telegram_init_data_ttl_seconds > 0:
        try:
            auth_timestamp = int(auth_date) if auth_date is not None else 0
        except ValueError as exc:
            raise HTTPException(status_code=400, detail='Invalid Telegram auth date') from exc

        if auth_timestamp <= 0:
            raise HTTPException(status_code=401, detail='Missing Telegram auth date')

        if auth_timestamp > time.time() + 60:
            raise HTTPException(status_code=401, detail='Telegram auth date is in the future')

        if time.time() - auth_timestamp > settings.telegram_init_data_ttl_seconds:
            raise HTTPException(status_code=401, detail='Telegram init data is expired')

    user_payload = init_data.get('user')

    if not user_payload:
        raise HTTPException(status_code=401, detail='Missing Telegram user payload')

    try:
        user = json.loads(user_payload)
        int(user['id'])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail='Invalid Telegram user payload') from exc

    return user


async def get_auth_principal(
    authorization: Optional[str] = Header(None),
    x_telegram_init_data: Optional[str] = Header(None),
    x_telegram_user_id: Optional[str] = Header(None),
) -> AuthPrincipal:
    """
    Определяет, кто выполняет запрос, любым поддерживаемым способом.

    Сессионный токен (нативный клиент и веб вне Telegram) имеет приоритет,
    затем подписанный initData Telegram WebApp. Локальная разработка может
    подставлять X-Telegram-User-Id, но только пока не задан токен бота.

    :param authorization: Заголовок Authorization вида `Bearer <token>`.
    :param x_telegram_init_data: Подписанный initData Telegram WebApp.
    :param x_telegram_user_id: Dev-only идентификатор без подписи.
    :return: Данные об аутентифицированном субъекте.
    """
    if authorization:
        scheme, _, token = authorization.partition(' ')

        if scheme.lower() != 'bearer' or not token:
            raise HTTPException(status_code=401, detail='Invalid authorization header')

        token_hash = session_token_hash(token)
        user_id = await auth.get__session_user(token_hash, settings.session_ttl_seconds)

        if user_id is None:
            raise HTTPException(status_code=401, detail='Сессия истекла, войдите заново')

        return AuthPrincipal(session_user_id=user_id, session_token_hash=token_hash)

    if x_telegram_init_data:
        user = parse_telegram_init_data(x_telegram_init_data)
        return AuthPrincipal(
            telegram_id=int(user['id']),
            username=user.get('username'),
            first_name=user.get('first_name'),
            last_name=user.get('last_name'),
        )

    # Dev-only fallback: accept user ID from header without signature.
    # Never allowed in production; otherwise only when bot token is not configured.
    if settings.is_production or settings.telegram_bot_token:
        raise HTTPException(status_code=401, detail='Missing credentials')

    if x_telegram_user_id is None:
        raise HTTPException(status_code=401, detail='Missing Telegram user context')

    try:
        uid = int(x_telegram_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail='Invalid user id') from None

    return AuthPrincipal(telegram_id=uid)


async def resolve_user_id(principal: AuthPrincipal) -> Optional[int]:
    """
    Находит аккаунт, которому принадлежит аутентифицированный субъект.

    Для Telegram это не то же самое, что telegram_id: у пользователя,
    зарегистрировавшегося по email и позже привязавшего Telegram,
    идентификатор аккаунта свой.

    :param principal: Аутентифицированный субъект.
    :return: Идентификатор аккаунта или None, если аккаунта еще нет.
    """
    if principal.session_user_id is not None:
        return principal.session_user_id

    if principal.telegram_id is None:
        return None

    identity = await auth.get__auth_identity(PROVIDER_TELEGRAM, str(principal.telegram_id))

    return int(identity['user_id']) if identity else None


async def get_current_user(
    principal: AuthPrincipal = Depends(get_auth_principal),
) -> CurrentUser:
    """
    Возвращает владельца существующего аккаунта.
    :param principal: Аутентифицированный субъект.
    :return: Аккаунт, от имени которого выполняется запрос.
    """
    user_id = await resolve_user_id(principal)

    if user_id is None:
        # Не 401: аутентификация прошла, просто аккаунта за этим входом ещё
        # нет. Клиенту нужно различать эти случаи — на 401 он сбрасывает
        # сессию, а здесь надо предложить создать аккаунт или войти в свой.
        raise HTTPException(status_code=404, detail='Аккаунт не найден, требуется регистрация')

    return CurrentUser(
        user_id=user_id,
        session_token_hash=principal.session_token_hash,
    )
