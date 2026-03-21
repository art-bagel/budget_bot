from dataclasses import dataclass
import hashlib
import hmac
import json
import time
from typing import Optional
from urllib.parse import parse_qsl

from fastapi import Header, HTTPException

from backend.app.config import settings


@dataclass
class TelegramUser:
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


async def get_telegram_user(
    x_telegram_init_data: Optional[str] = Header(None),
    x_telegram_user_id: Optional[str] = Header(None),
) -> TelegramUser:
    """
    Извлекает пользователя Telegram из запроса.

    Продакшен (WebApp): пользователь извлекается из initData с HMAC-валидацией.
    Локальная разработка: user_id из заголовка X-Telegram-User-Id.
    """
    if x_telegram_init_data:
        if not settings.telegram_bot_token:
            raise HTTPException(status_code=500, detail='Telegram bot token is not configured on the server')

        try:
            pairs = parse_qsl(x_telegram_init_data, keep_blank_values=True)
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
            user_id = int(user['id'])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail='Invalid Telegram user payload') from exc

        return TelegramUser(
            user_id=user_id,
            username=user.get('username'),
            first_name=user.get('first_name'),
            last_name=user.get('last_name'),
        )

    # Dev-only fallback: accept user ID from header without signature.
    # Only allowed when Telegram bot token is not configured (local dev).
    if settings.telegram_bot_token:
        raise HTTPException(status_code=401, detail='Missing Telegram init data')

    if x_telegram_user_id is None:
        raise HTTPException(status_code=401, detail='Missing Telegram user context')

    try:
        uid = int(x_telegram_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail='Invalid user id')

    return TelegramUser(user_id=uid)
