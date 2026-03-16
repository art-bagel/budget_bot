from typing import List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import ledger


router = APIRouter(prefix='/api/v1/scheduled-expenses', tags=['scheduled-expenses'])


class ScheduledExpenseItem(BaseModel):
    id: int
    category_id: int
    amount: float
    currency_code: str
    comment: Optional[str] = None
    frequency: Literal['weekly', 'monthly']
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    next_run_at: str
    last_run_at: Optional[str] = None
    last_error: Optional[str] = None
    is_active: bool


class AccountCurrencyItem(BaseModel):
    code: str
    amount: float


class CreateScheduledExpenseRequest(BaseModel):
    category_id: int
    amount: float
    currency_code: str
    frequency: Literal['weekly', 'monthly']
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    comment: Optional[str] = None


class CreateScheduledExpenseResponse(BaseModel):
    id: int
    next_run_at: str


@router.get('/category/{category_id}/currencies', response_model=List[AccountCurrencyItem])
async def get_category_account_currencies(
    category_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await ledger.get__category_account_currencies(user.user_id, category_id)


@router.get('/', response_model=List[ScheduledExpenseItem])
async def get_scheduled_expenses(
    category_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await ledger.get__scheduled_expenses_for_category(user.user_id, category_id)


@router.post('/', response_model=CreateScheduledExpenseResponse)
async def create_scheduled_expense(
    body: CreateScheduledExpenseRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CreateScheduledExpenseResponse:
    result = await ledger.put__create_scheduled_expense(
        user_id=user.user_id,
        category_id=body.category_id,
        amount=body.amount,
        currency_code=body.currency_code,
        frequency=body.frequency,
        day_of_week=body.day_of_week,
        day_of_month=body.day_of_month,
        comment=body.comment,
    )
    return CreateScheduledExpenseResponse(**result)


@router.delete('/{schedule_id}')
async def delete_scheduled_expense(
    schedule_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    await ledger.put__delete_scheduled_expense(user.user_id, schedule_id)
    return {'status': 'deleted', 'id': schedule_id}
