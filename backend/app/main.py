import asyncio
import logging
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse

logger = logging.getLogger(__name__)

from backend.app.config import settings
from backend.app.routers import auth, bank_accounts, categories, currencies, dashboard, families, groups, income_sources, operations, portfolio, user_settings, scheduled_expenses, tinkoff
from backend.app import storage as app_storage
from backend.app.scheduler import scheduler_loop


@asynccontextmanager
async def lifespan(application: FastAPI):
    scheduler_task = asyncio.create_task(scheduler_loop(app_storage.ledger))
    yield
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    await app_storage.context.close()
    await app_storage.ledger.close()
    await app_storage.reports.close()


app = FastAPI(
    title='Budgeting App API',
    version='0.1.0',
    description='API for the budgeting application.',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type', 'X-Telegram-Init-Data', 'X-Telegram-User-Id'],
)

app.include_router(auth.router)
app.include_router(bank_accounts.router)
app.include_router(categories.router)
app.include_router(currencies.router)
app.include_router(dashboard.router)
app.include_router(families.router)
app.include_router(groups.router)
app.include_router(income_sources.router)
app.include_router(operations.router)
app.include_router(portfolio.router)
app.include_router(user_settings.router)
app.include_router(scheduled_expenses.router)
app.include_router(tinkoff.router)


@app.exception_handler(asyncpg.PostgresError)
async def postgres_exception_handler(_request: Request, exc: asyncpg.PostgresError) -> PlainTextResponse:
    if isinstance(exc, asyncpg.RaiseError):
        return PlainTextResponse(str(exc), status_code=400)
    logger.error('Database error: %s', exc)
    return PlainTextResponse('Внутренняя ошибка сервера', status_code=500)


@app.get('/health')
async def healthcheck() -> dict:
    return {
        'status': 'ok',
        'schema': settings.db_schema,
        'frontend_origins': settings.frontend_origins,
    }
