from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app import storage as app_storage
from storage.tinkoff_sync import TinkoffConnections, TinkoffSync

router = APIRouter(prefix='/api/v1/tinkoff', tags=['tinkoff'])


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


class ApplyTinkoffSyncRequest(BaseModel):
    deposit_resolutions: List[DepositResolution]


# ---------------------------------------------------------------------------
# Helper: get pool from existing storage
# ---------------------------------------------------------------------------

async def _get_pool():
    return await app_storage.context._get_pool()


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
            'SELECT credentials, provider_account_id, linked_account_id '
            'FROM budgeting.external_connections WHERE id = $1',
            connection_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail='Connection not found')

    token = row['credentials']['token']
    tinkoff_account_id = row['provider_account_id']
    linked_account_id = row['linked_account_id']

    sync = TinkoffSync(pool)
    try:
        return await sync.preview(token, tinkoff_account_id, linked_account_id, user.user_id)
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
    try:
        return await sync.apply(connection_id, resolutions, user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _handle_tinkoff_error(exc) from exc
