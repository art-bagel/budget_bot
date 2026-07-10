import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

from dotenv import load_dotenv

from backend.app.bootstrap import PROJECT_ROOT
from storage.databases import ConnectData


BACKEND_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(BACKEND_ROOT / '.env')


@dataclass(frozen=True)
class Settings:
    app_env: str
    app_host: str
    app_port: int
    frontend_origins: List[str]
    telegram_bot_token: str | None
    telegram_init_data_ttl_seconds: int
    credentials_encryption_key: str | None
    db_host: str
    db_port: int
    db_database: str
    db_schema: str
    postgres_user: str
    postgres_password: str

    @property
    def is_production(self) -> bool:
        return self.app_env == 'production'


def _get_frontend_origins() -> List[str]:
    origins = os.getenv(
        'FRONTEND_ORIGINS',
        'http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173',
    )
    return [origin.strip() for origin in origins.split(',') if origin.strip()]


settings = Settings(
    app_env=os.getenv('APP_ENV', 'development').strip().lower(),
    app_host=os.getenv('APP_HOST'),
    app_port=int(os.getenv('APP_PORT')),
    frontend_origins=_get_frontend_origins(),
    telegram_bot_token=os.getenv('TELEGRAM_BOT_TOKEN') or None,
    telegram_init_data_ttl_seconds=int(os.getenv('TELEGRAM_INIT_DATA_TTL_SECONDS', '10800')),
    credentials_encryption_key=os.getenv('CREDENTIALS_ENCRYPTION_KEY') or None,
    db_host=os.getenv('DB_HOST'),
    db_port=int(os.getenv('DB_PORT')),
    db_database=os.getenv('DB_DATABASE'),
    db_schema=os.getenv('DB_SCHEMA'),
    postgres_user=os.getenv('POSTGRES_USER'),
    postgres_password=os.getenv('POSTGRES_PASSWORD'),
)


def _validate_production_settings(current: Settings) -> None:
    """Fail fast: в production запрещены дырявые дефолты dev-режима."""
    if not current.is_production:
        return

    missing = []
    if not current.telegram_bot_token:
        missing.append('TELEGRAM_BOT_TOKEN')
    if not current.credentials_encryption_key:
        missing.append('CREDENTIALS_ENCRYPTION_KEY')

    if missing:
        raise RuntimeError(
            'APP_ENV=production, but required settings are missing: '
            + ', '.join(missing)
        )


_validate_production_settings(settings)

postgres_conn = ConnectData(
    host=settings.db_host,
    port=settings.db_port,
    database=settings.db_database,
    schema=settings.db_schema,
    username=settings.postgres_user,
    password=settings.postgres_password,
)
