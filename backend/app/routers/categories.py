from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/categories', tags=['categories'])


class CategoryItem(BaseModel):
    id: int
    name: str
    kind: str
    is_active: bool
    created_at: str


class CreateCategoryRequest(BaseModel):
    name: str
    kind: Literal['regular', 'group']


class CreateCategoryResponse(BaseModel):
    id: int


class ArchiveCategoryResponse(BaseModel):
    category_id: int
    kind: str
    name: str
    is_active: bool


@router.get('', response_model=List[CategoryItem])
async def get_categories(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
) -> list:
    return await reports.get__categories(user.user_id, is_active)


@router.post('', response_model=CreateCategoryResponse)
async def create_category(
    body: CreateCategoryRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CreateCategoryResponse:
    category_id = await context.put__create_category(
        user_id=user.user_id,
        name=body.name,
        kind=body.kind,
    )
    return CreateCategoryResponse(id=category_id)


@router.post('/{category_id}/archive', response_model=ArchiveCategoryResponse)
async def archive_category(
    category_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> ArchiveCategoryResponse:
    result = await context.set__archive_category(
        user_id=user.user_id,
        category_id=category_id,
    )
    return ArchiveCategoryResponse(**result)
