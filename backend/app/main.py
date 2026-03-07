from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import settings
from backend.app.routers import auth, categories, currencies, groups, operations
from backend.app import storage as app_storage


@asynccontextmanager
async def lifespan(application: FastAPI):
    yield
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
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(currencies.router)
app.include_router(groups.router)
app.include_router(operations.router)


@app.get('/health')
async def healthcheck() -> dict:
    return {
        'status': 'ok',
        'schema': settings.db_schema,
        'frontend_origins': settings.frontend_origins,
    }
