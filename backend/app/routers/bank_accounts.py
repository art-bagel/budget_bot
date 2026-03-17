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
    account_kind: Literal['cash', 'investment']
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None
    is_primary: bool
    is_active: bool
    created_at: str


class CreateBankAccountRequest(BaseModel):
    name: str
    owner_type: Literal['user', 'family'] = 'user'
    account_kind: Literal['cash', 'investment'] = 'investment'
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None


@router.get('', response_model=List[BankAccountItem])
async def get_bank_accounts(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
    account_kind: Optional[Literal['cash', 'investment']] = Query('cash'),
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
