from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context


router = APIRouter(prefix='/api/v1/auth', tags=['auth'])


class RegisterRequest(BaseModel):
    base_currency_code: str


class RegisterResponse(BaseModel):
    status: str
    user_id: int
    bank_account_id: int
    unallocated_category_id: int
    fx_result_category_id: int
    base_currency_code: str


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
