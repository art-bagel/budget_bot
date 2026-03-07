from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException


@dataclass
class TelegramUser:
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


async def get_telegram_user(
    x_telegram_user_id: Optional[str] = Header(None),
) -> TelegramUser:
    """
    Извлекает пользователя Telegram из запроса.

    Продакшен (WebApp): валидация initData — будет добавлена позже.
    Локальная разработка: user_id из заголовка X-Telegram-User-Id.
    """
    if x_telegram_user_id is None:
        raise HTTPException(status_code=401, detail='Missing Telegram user context')

    try:
        uid = int(x_telegram_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail='Invalid user id')

    return TelegramUser(user_id=uid)
