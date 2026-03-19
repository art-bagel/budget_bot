from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/bank-accounts', tags=['bank-accounts'])


class BankAccountItem(BaseModel):
    id: int
    name: str
    owner_type: str
    owner_user_id: Optional[int] = None
    owner_family_id: Optional[int] = None
    owner_name: str
    account_kind: Literal['cash', 'investment', 'credit']
    credit_kind: Optional[Literal['loan', 'credit_card', 'mortgage']] = None
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[str] = None
    credit_ends_at: Optional[str] = None
    credit_limit: Optional[float] = None
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None
    is_primary: bool
    is_active: bool
    created_at: str


class BankAccountBalanceItem(BaseModel):
    currency_code: str
    amount: float
    historical_cost_in_base: float
    base_currency_code: str


class CreateBankAccountRequest(BaseModel):
    name: str
    owner_type: Literal['user', 'family'] = 'user'
    account_kind: Literal['cash', 'investment'] = 'investment'
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None


class CreateCreditAccountRequest(BaseModel):
    name: str
    credit_kind: Literal['loan', 'credit_card', 'mortgage']
    currency_code: str
    initial_debt: Optional[float] = None
    target_account_id: Optional[int] = None
    owner_type: Literal['user', 'family'] = 'user'
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[str] = None
    credit_ends_at: Optional[str] = None
    credit_limit: Optional[float] = None
    provider_name: Optional[str] = None


@router.get('', response_model=List[BankAccountItem])
async def get_bank_accounts(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
    account_kind: Optional[Literal['cash', 'investment', 'credit']] = Query('cash'),
) -> list:
    return await reports.get__bank_accounts(user.user_id, is_active, account_kind)


@router.post('', response_model=BankAccountItem)
async def create_bank_account(
    body: CreateBankAccountRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> BankAccountItem:
    result = await context.put__create_bank_account(
        user_id=user.user_id,
        name=body.name,
        owner_type=body.owner_type,
        account_kind=body.account_kind,
        provider_name=body.provider_name,
        provider_account_ref=body.provider_account_ref,
    )
    return BankAccountItem(**result)


@router.post('/credit', response_model=BankAccountItem)
async def create_credit_account(
    body: CreateCreditAccountRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> BankAccountItem:
    result = await context.put__create_credit_account(
        user_id=user.user_id,
        name=body.name,
        credit_kind=body.credit_kind,
        currency_code=body.currency_code,
        initial_debt=body.initial_debt or 0,
        owner_type=body.owner_type,
        interest_rate=body.interest_rate,
        payment_day=body.payment_day,
        credit_started_at=date.fromisoformat(body.credit_started_at) if body.credit_started_at else None,
        credit_ends_at=date.fromisoformat(body.credit_ends_at) if body.credit_ends_at else None,
        credit_limit=body.credit_limit,
        target_account_id=body.target_account_id,
        provider_name=body.provider_name,
    )
    return BankAccountItem(**result)


@router.get('/{bank_account_id}/snapshot', response_model=List[BankAccountBalanceItem])
async def get_bank_account_snapshot(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__bank_snapshot(user.user_id, bank_account_id)
