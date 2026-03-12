from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/groups', tags=['groups'])


class GroupMemberItem(BaseModel):
    child_category_id: int
    child_category_name: str
    child_category_kind: str
    child_owner_type: str
    share: float


class ReplaceGroupMembersRequest(BaseModel):
    group_id: int
    child_category_ids: List[int]
    shares: List[float]


class ReplaceGroupMembersResponse(BaseModel):
    group_id: int
    members_count: int


@router.get('/{group_id}/members', response_model=List[GroupMemberItem])
async def get_group_members(
    group_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__group_members(user.user_id, group_id)


@router.put('/members', response_model=ReplaceGroupMembersResponse)
async def replace_group_members(
    body: ReplaceGroupMembersRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> ReplaceGroupMembersResponse:
    result = await context.set__replace_group_members(
        user_id=user.user_id,
        group_id=body.group_id,
        child_category_ids=body.child_category_ids,
        shares=body.shares,
    )
    return ReplaceGroupMembersResponse(**result)
