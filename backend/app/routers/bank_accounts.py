from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator

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
    investment_asset_type: Optional[Literal['security', 'deposit', 'crypto']] = None
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
    investment_asset_type: Optional[Literal['security', 'deposit', 'crypto']] = None
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()


class CreateCreditAccountRequest(BaseModel):
    name: str
    credit_kind: Literal['loan', 'credit_card', 'mortgage']
    currency_code: str
    credit_limit: float
    target_account_id: Optional[int] = None
    owner_type: Literal['user', 'family'] = 'user'
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[date] = None
    credit_ends_at: Optional[date] = None
    provider_name: Optional[str] = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()

    @field_validator('credit_limit')
    @classmethod
    def credit_limit_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Кредитный лимит должен быть положительным')
        return v

    @field_validator('payment_day')
    @classmethod
    def payment_day_must_be_valid(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 31):
            raise ValueError('День платежа должен быть от 1 до 31')
        return v


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
        investment_asset_type=body.investment_asset_type,
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
        credit_limit=body.credit_limit,
        target_account_id=body.target_account_id,
        owner_type=body.owner_type,
        interest_rate=body.interest_rate,
        payment_day=body.payment_day,
        credit_started_at=body.credit_started_at,
        credit_ends_at=body.credit_ends_at,
        provider_name=body.provider_name,
    )
    return BankAccountItem(**result)


@router.post('/credit/{bank_account_id}/archive')
async def archive_credit_account(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    return await context.set__archive_credit_account(
        user_id=user.user_id,
        bank_account_id=bank_account_id,
    )


@router.get('/{bank_account_id}/snapshot', response_model=List[BankAccountBalanceItem])
async def get_bank_account_snapshot(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__bank_snapshot(user.user_id, bank_account_id)
