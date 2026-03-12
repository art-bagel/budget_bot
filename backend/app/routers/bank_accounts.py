from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import reports


router = APIRouter(prefix='/api/v1/bank-accounts', tags=['bank-accounts'])


class BankAccountItem(BaseModel):
    id: int
    name: str
    owner_type: str
    owner_user_id: Optional[int] = None
    owner_family_id: Optional[int] = None
    owner_name: str
    is_primary: bool
    is_active: bool
    created_at: str


@router.get('', response_model=List[BankAccountItem])
async def get_bank_accounts(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
) -> list:
    return await reports.get__bank_accounts(user.user_id, is_active)
