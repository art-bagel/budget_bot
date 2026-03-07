from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import ledger


router = APIRouter(prefix='/api/v1/operations', tags=['operations'])


class RecordIncomeRequest(BaseModel):
    bank_account_id: int
    amount: float
    currency_code: str
    budget_amount_in_base: Optional[float] = None
    comment: Optional[str] = None


class RecordIncomeResponse(BaseModel):
    operation_id: int
    budget_amount_in_base: float
    base_currency_code: str


@router.post('/income', response_model=RecordIncomeResponse)
async def record_income(
    body: RecordIncomeRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RecordIncomeResponse:
    result = await ledger.put__record_income(
        user_id=user.user_id,
        bank_account_id=body.bank_account_id,
        amount=body.amount,
        currency_code=body.currency_code,
        budget_amount_in_base=body.budget_amount_in_base,
        comment=body.comment,
    )
    return RecordIncomeResponse(**result)
