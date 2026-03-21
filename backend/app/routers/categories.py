from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/categories', tags=['categories'])


class CategoryItem(BaseModel):
    id: int
    name: str
    kind: str
    owner_type: str
    owner_user_id: Optional[int] = None
    owner_family_id: Optional[int] = None
    owner_name: Optional[str] = None
    is_active: bool
    created_at: str


class CreateCategoryRequest(BaseModel):
    name: str
    kind: Literal['regular', 'group']
    owner_type: Literal['user', 'family'] = 'user'

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()


class CreateCategoryResponse(BaseModel):
    id: int


class UpdateCategoryRequest(BaseModel):
    name: str

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()


class ArchiveCategoryResponse(BaseModel):
    category_id: int
    kind: str
    name: str
    is_active: bool


class ParentGroupItem(BaseModel):
    group_id: int
    group_name: str


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
        owner_type=body.owner_type,
    )
    return CreateCategoryResponse(id=category_id)


@router.put('/{category_id}', response_model=CategoryItem)
async def update_category(
    category_id: int,
    body: UpdateCategoryRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CategoryItem:
    result = await context.set__update_category(
        user_id=user.user_id,
        category_id=category_id,
        name=body.name,
    )
    return CategoryItem(**result)


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


@router.get('/{category_id}/parent-groups', response_model=List[ParentGroupItem])
async def get_category_parent_groups(
    category_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__category_parent_groups(user.user_id, category_id)
