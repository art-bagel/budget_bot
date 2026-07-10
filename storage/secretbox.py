"""Симметричное шифрование секретов внешних подключений (Fernet).

Ключ берется из env CREDENTIALS_ENCRYPTION_KEY (Fernet, base64).
Зашифрованные значения хранятся с префиксом ``enc:v1:``. Значения без префикса
считаются legacy plaintext и возвращаются как есть — они перешифровываются при
следующем пересохранении подключения.
"""
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

ENC_PREFIX = 'enc:v1:'

_fernet: Optional[Fernet] = None
_fernet_key_used: Optional[str] = None


def _get_fernet() -> Optional[Fernet]:
    """
    Возвращает Fernet для текущего ключа из env (или None, если ключ не задан).
    """
    global _fernet, _fernet_key_used

    key = os.getenv('CREDENTIALS_ENCRYPTION_KEY') or None

    if key != _fernet_key_used:
        _fernet = Fernet(key.encode()) if key else None
        _fernet_key_used = key

    return _fernet


def encrypt_secret(plaintext: str) -> str:
    """
    Шифрует секрет для хранения в БД.
    Без ключа (локальная разработка) возвращает plaintext как есть;
    в production ключ обязателен на уровне настроек приложения.
    """
    fernet = _get_fernet()

    if fernet is None:
        return plaintext

    return ENC_PREFIX + fernet.encrypt(plaintext.encode()).decode()


def decrypt_secret(value: str) -> str:
    """
    Расшифровывает секрет из БД.
    Значения без префикса — legacy plaintext, возвращаются как есть.
    """
    if not value or not value.startswith(ENC_PREFIX):
        return value

    fernet = _get_fernet()

    if fernet is None:
        raise RuntimeError(
            'CREDENTIALS_ENCRYPTION_KEY is not set, cannot decrypt stored credentials'
        )

    try:
        return fernet.decrypt(value[len(ENC_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise ValueError('Stored credential cannot be decrypted with the current key') from exc
