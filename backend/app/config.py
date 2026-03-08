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
    app_host: str
    app_port: int
    frontend_origins: List[str]
    telegram_bot_token: str | None
    telegram_init_data_ttl_seconds: int
    db_host: str
    db_port: int
    db_database: str
    db_schema: str
    postgres_user: str
    postgres_password: str


def _get_frontend_origins() -> List[str]:
    origins = os.getenv(
        'FRONTEND_ORIGINS',
        'http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173',
    )
    return [origin.strip() for origin in origins.split(',') if origin.strip()]


settings = Settings(
    app_host=os.getenv('APP_HOST'),
    app_port=int(os.getenv('APP_PORT')),
    frontend_origins=_get_frontend_origins(),
    telegram_bot_token=os.getenv('TELEGRAM_BOT_TOKEN'),
    telegram_init_data_ttl_seconds=int(os.getenv('TELEGRAM_INIT_DATA_TTL_SECONDS', '86400')),
    db_host=os.getenv('DB_HOST'),
    db_port=int(os.getenv('DB_PORT')),
    db_database=os.getenv('DB_DATABASE'),
    db_schema=os.getenv('DB_SCHEMA'),
    postgres_user=os.getenv('POSTGRES_USER'),
    postgres_password=os.getenv('POSTGRES_PASSWORD'),
)

postgres_conn = ConnectData(
    host=settings.db_host,
    port=settings.db_port,
    database=settings.db_database,
    schema=settings.db_schema,
    username=settings.postgres_user,
    password=settings.postgres_password,
)
