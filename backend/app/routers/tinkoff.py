import asyncio
import json
import logging
import re
from pathlib import Path
from typing import List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app import storage as app_storage
from storage.tinkoff_sync import TinkoffConnections, TinkoffSync

router = APIRouter(prefix='/api/v1/tinkoff', tags=['tinkoff'])
logger = logging.getLogger(__name__)
LOGO_CACHE_DIR = Path(__file__).resolve().parents[2] / '.cache' / 'tinkoff-logos'
_logo_download_locks: dict[str, asyncio.Lock] = {}
_LOGO_NAME_RE = re.compile(r'^(?P<base>[A-Za-z0-9._-]+?)(?:x160)?(?:\.png)?$')


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TinkoffAccount(BaseModel):
    provider_account_id: str
    name: str
    type: str


class GetAccountsRequest(BaseModel):
    token: str


class ConnectTinkoffRequest(BaseModel):
    token: str
    provider_account_id: str
    linked_account_id: int


class ExternalConnection(BaseModel):
    id: int
    provider: str
    provider_account_id: str
    linked_account_id: Optional[int]
    linked_account_name: Optional[str]
    last_synced_at: Optional[str]
    is_active: bool
    created_at: str


class DepositResolution(BaseModel):
    tinkoff_op_id: str
    resolution: Literal['external', 'transfer', 'already_recorded']
    source_account_id: Optional[int] = None


class WithdrawalResolution(BaseModel):
    tinkoff_op_id: str
    resolution: Literal['external', 'transfer', 'already_recorded']
    target_account_id: Optional[int] = None


class ApplyTinkoffSyncRequest(BaseModel):
    deposit_resolutions: List[DepositResolution]
    withdrawal_resolutions: List[WithdrawalResolution] = []


class TinkoffLivePrice(BaseModel):
    position_id: int
    price: float
    clean_price: Optional[float] = None
    currency_code: str
    current_value: float
    clean_current_value: Optional[float] = None
    source: str


# ---------------------------------------------------------------------------
# Helper: get pool from existing storage
# ---------------------------------------------------------------------------

async def _get_pool():
    return await app_storage.context._get_pool()


def _normalize_logo_name(value: str) -> str:
    match = _LOGO_NAME_RE.fullmatch(value.strip())
    if not match:
        raise HTTPException(status_code=400, detail='Invalid logo name')
    return match.group('base')


def _logo_cache_path(logo_name: str) -> Path:
    return LOGO_CACHE_DIR / f'{logo_name}x160.png'


def _logo_download_lock(logo_name: str) -> asyncio.Lock:
    lock = _logo_download_locks.get(logo_name)
    if lock is None:
        lock = asyncio.Lock()
        _logo_download_locks[logo_name] = lock
    return lock


async def _ensure_logo_cached(logo_name: str) -> Path:
    cache_path = _logo_cache_path(logo_name)
    if cache_path.exists():
        return cache_path

    async with _logo_download_lock(logo_name):
        if cache_path.exists():
            return cache_path

        LOGO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        url = f'https://invest-brands.cdn-tinkoff.ru/{logo_name}x160.png'
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(url)

        if response.status_code == 404:
            raise HTTPException(status_code=404, detail='Logo not found')
        if not response.is_success:
            raise HTTPException(status_code=502, detail='Failed to fetch instrument logo')

        tmp_path = cache_path.with_suffix('.tmp')
        tmp_path.write_bytes(response.content)
        tmp_path.replace(cache_path)
        return cache_path


def _handle_tinkoff_error(exc: Exception) -> HTTPException:
    """Map Tinkoff REST / internal errors to HTTP exceptions."""
    msg = str(exc)

    if isinstance(exc, ValueError):
        return HTTPException(status_code=404, detail=msg)

    if isinstance(exc, PermissionError) or 'UNAUTHENTICATED' in msg or 'invalid token' in msg.lower():
        return HTTPException(status_code=400, detail='Invalid token — check your Tinkoff API token')

    if 'PERMISSION_DENIED' in msg:
        return HTTPException(status_code=400, detail='Access denied to this Tinkoff account')

    if 'RESOURCE_EXHAUSTED' in msg:
        return HTTPException(status_code=429, detail='Tinkoff API rate limit exceeded, try again later')

    if 'UNAVAILABLE' in msg:
        return HTTPException(status_code=503, detail='Tinkoff API is temporarily unavailable')

    return HTTPException(status_code=400, detail=msg)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post('/accounts', response_model=List[TinkoffAccount])
async def get_tinkoff_accounts(
    body: GetAccountsRequest,
    _user: TelegramUser = Depends(get_telegram_user),
) -> list:
    """Validate token and return list of Tinkoff broker accounts. Nothing is saved."""
    pool = await _get_pool()
    tc = TinkoffConnections(pool)
    try:
        return await tc.get_accounts_from_token(body.token)
    except Exception as exc:
        raise _handle_tinkoff_error(exc) from exc


@router.post('/connect', response_model=dict)
async def connect_tinkoff(
    body: ConnectTinkoffRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    """Save token + bind a Tinkoff account to our investment account."""
    pool = await _get_pool()
    tc = TinkoffConnections(pool)
    try:
        return await tc.create_connection(
            user_id=user.user_id,
            token=body.token,
            provider_account_id=body.provider_account_id,
            linked_account_id=body.linked_account_id,
        )
    except Exception as exc:
        raise _handle_tinkoff_error(exc) from exc


@router.get('/connections', response_model=List[dict])
async def list_connections(
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    pool = await _get_pool()
    tc = TinkoffConnections(pool)
    return await tc.list_connections(user.user_id)


@router.delete('/connections/{connection_id}', response_model=dict)
async def delete_connection(
    connection_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    pool = await _get_pool()
    tc = TinkoffConnections(pool)
    try:
        await tc.delete_connection(connection_id, user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {'status': 'deleted', 'id': connection_id}


@router.get('/preview/{connection_id}', response_model=dict)
async def preview_tinkoff_sync(
    connection_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    """Dry-run: fetch new operations from Tinkoff without writing anything."""
    pool = await _get_pool()
    tc = TinkoffConnections(pool)

    # Access check: connection must belong to this user/family
    connections = await tc.list_connections(user.user_id)
    if not any(c['id'] == connection_id for c in connections):
        raise HTTPException(status_code=404, detail='Connection not found')

    # Load credentials directly
    async with pool.acquire() as db_conn:
        row = await db_conn.fetchrow(
            'SELECT * FROM budgeting.external_connections WHERE id = $1',
            connection_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail='Connection not found')

    conn_row = dict(row)
    creds = conn_row['credentials']
    if isinstance(creds, str):
        creds = json.loads(creds)
    token = creds['token']
    tinkoff_account_id = conn_row['provider_account_id']
    linked_account_id = conn_row['linked_account_id']

    sync = TinkoffSync(pool)
    try:
        return await sync.preview(token, tinkoff_account_id, linked_account_id, user.user_id, conn_row=conn_row)
    except Exception as exc:
        raise _handle_tinkoff_error(exc) from exc


@router.post('/apply/{connection_id}', response_model=dict)
async def apply_tinkoff_sync(
    connection_id: int,
    body: ApplyTinkoffSyncRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    """Apply synced operations with user resolutions for deposits."""
    pool = await _get_pool()
    tc = TinkoffConnections(pool)

    # Access check
    connections = await tc.list_connections(user.user_id)
    if not any(c['id'] == connection_id for c in connections):
        raise HTTPException(status_code=404, detail='Connection not found')

    sync = TinkoffSync(pool)
    resolutions = [r.model_dump() for r in body.deposit_resolutions]
    withdrawal_resolutions = [r.model_dump() for r in body.withdrawal_resolutions]
    try:
        return await sync.apply(connection_id, resolutions, withdrawal_resolutions, user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _handle_tinkoff_error(exc) from exc


@router.get('/live-prices', response_model=List[TinkoffLivePrice])
async def get_tinkoff_live_prices(
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    pool = await _get_pool()
    sync = TinkoffSync(pool)
    try:
        return await sync.get_live_position_prices(user.user_id)
    except Exception as exc:
        # Live prices are a best-effort enhancement for UI valuation,
        # so gracefully degrade to MOEX/cost basis when T-Bank is unavailable.
        logger.exception('Failed to resolve T-Bank live prices for user %s: %s', user.user_id, exc)
        return []


@router.get('/instrument-logo/{logo_name}')
async def get_tinkoff_instrument_logo(logo_name: str) -> FileResponse:
    normalized_logo_name = _normalize_logo_name(logo_name)
    try:
        cache_path = await _ensure_logo_cached(normalized_logo_name)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('Failed to cache T-Bank logo %s: %s', normalized_logo_name, exc)
        raise HTTPException(status_code=502, detail='Failed to fetch instrument logo') from exc

    return FileResponse(
        cache_path,
        media_type='image/png',
        headers={'Cache-Control': 'public, max-age=2592000'},
    )
