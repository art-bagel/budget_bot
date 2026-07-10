import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.config import settings
from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context


router = APIRouter(prefix='/api/v1/auth', tags=['auth'])

DELETE_CONFIRM_TTL_SECONDS = 600


def _delete_confirm_secret() -> bytes:
    secret = settings.telegram_bot_token or settings.credentials_encryption_key or 'dev-only-secret'
    return secret.encode()


def _sign_delete_request(user_id: int, timestamp: int) -> str:
    payload = f'delete-account:{user_id}:{timestamp}'.encode()
    return hmac.new(_delete_confirm_secret(), payload, hashlib.sha256).hexdigest()


def _build_delete_confirm_token(user_id: int) -> str:
    timestamp = int(time.time())
    return f'{timestamp}.{_sign_delete_request(user_id, timestamp)}'


def _verify_delete_confirm_token(user_id: int, token: str) -> bool:
    timestamp_part, _, signature = token.partition('.')

    try:
        timestamp = int(timestamp_part)
    except ValueError:
        return False

    if not signature or time.time() - timestamp > DELETE_CONFIRM_TTL_SECONDS:
        return False

    return hmac.compare_digest(_sign_delete_request(user_id, timestamp), signature)


class RegisterRequest(BaseModel):
    base_currency_code: str


class RegisterResponse(BaseModel):
    status: str
    user_id: int
    bank_account_id: int
    unallocated_category_id: int
    fx_result_category_id: int
    base_currency_code: str
    hints_enabled: bool
    theme: str = Field(default='system')


class DeleteAccountRequestResponse(BaseModel):
    confirm_token: str
    expires_in_seconds: int


class DeleteAccountResponse(BaseModel):
    status: str
    user_id: int


@router.post('/register', response_model=RegisterResponse)
async def register(
    body: RegisterRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RegisterResponse:
    result = await context.put__register_user_context(
        user_id=user.user_id,
        base_currency_code=body.base_currency_code,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
    )
    return RegisterResponse(**result)


@router.post('/account/delete-request', response_model=DeleteAccountRequestResponse)
async def request_account_deletion(
    user: TelegramUser = Depends(get_telegram_user),
) -> DeleteAccountRequestResponse:
    """
    Первый шаг удаления аккаунта: выдает короткоживущий подписанный токен.
    Само удаление возможно только по этому токену — случайный или единичный
    DELETE-запрос аккаунт не удалит.
    """
    return DeleteAccountRequestResponse(
        confirm_token=_build_delete_confirm_token(user.user_id),
        expires_in_seconds=DELETE_CONFIRM_TTL_SECONDS,
    )


@router.delete('/account', response_model=DeleteAccountResponse)
async def delete_account(
    confirm_token: str = Query(..., min_length=1),
    user: TelegramUser = Depends(get_telegram_user),
) -> DeleteAccountResponse:
    if not _verify_delete_confirm_token(user.user_id, confirm_token):
        raise HTTPException(
            status_code=400,
            detail='Недействительный или истекший токен подтверждения удаления',
        )

    result = await context.set__delete_user_account(user.user_id)
    return DeleteAccountResponse(**result)
