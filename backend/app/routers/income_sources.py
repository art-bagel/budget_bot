from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports
from backend.app.storage import ledger


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


class PatternLineItem(BaseModel):
    id: int
    bank_account_id: int
    bank_account_name: str
    bank_account_owner_type: str
    share: float


class PatternItem(BaseModel):
    id: int
    income_source_id: int
    lines: List[PatternLineItem]


class PatternLineInput(BaseModel):
    bank_account_id: int
    share: float


class UpsertPatternRequest(BaseModel):
    lines: List[PatternLineInput]


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


@router.get('/{income_source_id}/pattern', response_model=Optional[PatternItem])
async def get_income_source_pattern(
    income_source_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> Optional[dict]:
    result = await ledger.get__income_source_pattern(
        user_id=user.user_id,
        income_source_id=income_source_id,
    )
    return result


@router.put('/{income_source_id}/pattern', response_model=dict)
async def upsert_income_source_pattern(
    income_source_id: int,
    body: UpsertPatternRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    lines = [{'bank_account_id': line.bank_account_id, 'share': line.share} for line in body.lines]
    return await ledger.put__upsert_income_source_pattern(
        user_id=user.user_id,
        income_source_id=income_source_id,
        lines=lines,
    )


@router.delete('/{income_source_id}/pattern', response_model=dict)
async def delete_income_source_pattern(
    income_source_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    deleted = await ledger.put__delete_income_source_pattern(
        user_id=user.user_id,
        income_source_id=income_source_id,
    )
    return {'deleted': deleted}
