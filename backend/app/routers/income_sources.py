from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/income-sources', tags=['income-sources'])


class IncomeSourceItem(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: str


class CreateIncomeSourceRequest(BaseModel):
    name: str


class CreateIncomeSourceResponse(BaseModel):
    id: int


@router.get('', response_model=List[IncomeSourceItem])
async def get_income_sources(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
) -> list:
    return await reports.get__income_sources(user.user_id, is_active)


@router.post('', response_model=CreateIncomeSourceResponse)
async def create_income_source(
    body: CreateIncomeSourceRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CreateIncomeSourceResponse:
    income_source_id = await context.put__create_income_source(
        user_id=user.user_id,
        name=body.name,
    )
    return CreateIncomeSourceResponse(id=income_source_id)
