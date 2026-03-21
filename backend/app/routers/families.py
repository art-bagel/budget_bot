from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/family', tags=['family'])


class FamilyInfo(BaseModel):
    family_id: int
    name: str
    base_currency_code: str
    created_by_user_id: int
    created_at: str


class CreateFamilyRequest(BaseModel):
    name: Optional[str] = None


class CreateFamilyResponse(BaseModel):
    family_id: int
    name: str
    base_currency_code: str
    bank_account_id: int
    unallocated_category_id: int
    fx_result_category_id: int


class FamilyMemberItem(BaseModel):
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    joined_at: str


class InviteFamilyMemberRequest(BaseModel):
    username: str

    @field_validator('username')
    @classmethod
    def username_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Username не может быть пустым')
        return v.strip()


class InviteFamilyMemberResponse(BaseModel):
    invitation_id: int
    family_id: int
    invited_user_id: int
    status: str


class FamilyInvitationItem(BaseModel):
    invitation_id: int
    family_id: int
    family_name: str
    invited_by_user_id: int
    invited_by_username: Optional[str] = None
    status: str
    created_at: str
    responded_at: Optional[str] = None


class RespondFamilyInvitationResponse(BaseModel):
    invitation_id: int
    family_id: int
    status: str


class LeaveFamilyResponse(BaseModel):
    status: str
    user_id: int
    family_id: int


class DissolveFamilyResponse(BaseModel):
    status: str
    family_id: int
    dissolved_by_user_id: int


@router.get('/me', response_model=Optional[FamilyInfo])
async def get_my_family(
    user: TelegramUser = Depends(get_telegram_user),
) -> Optional[FamilyInfo]:
    result = await reports.get__my_family(user.user_id)
    return FamilyInfo(**result) if result else None


@router.post('', response_model=CreateFamilyResponse)
async def create_family(
    body: CreateFamilyRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CreateFamilyResponse:
    result = await context.put__create_family(user.user_id, body.name)
    return CreateFamilyResponse(**result)


@router.get('/members', response_model=List[FamilyMemberItem])
async def get_family_members(
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__family_members(user.user_id)


@router.get('/invitations', response_model=List[FamilyInvitationItem])
async def get_family_invitations(
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__family_invitations(user.user_id)


@router.post('/invite', response_model=InviteFamilyMemberResponse)
async def invite_family_member(
    body: InviteFamilyMemberRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> InviteFamilyMemberResponse:
    result = await context.put__invite_family_member(user.user_id, body.username)
    return InviteFamilyMemberResponse(**result)


@router.post('/invitations/{invitation_id}/accept', response_model=RespondFamilyInvitationResponse)
async def accept_family_invitation(
    invitation_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> RespondFamilyInvitationResponse:
    result = await context.set__respond_family_invitation(user.user_id, invitation_id, True)
    return RespondFamilyInvitationResponse(**result)


@router.post('/invitations/{invitation_id}/decline', response_model=RespondFamilyInvitationResponse)
async def decline_family_invitation(
    invitation_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> RespondFamilyInvitationResponse:
    result = await context.set__respond_family_invitation(user.user_id, invitation_id, False)
    return RespondFamilyInvitationResponse(**result)


@router.post('/leave', response_model=LeaveFamilyResponse)
async def leave_family(
    user: TelegramUser = Depends(get_telegram_user),
) -> LeaveFamilyResponse:
    result = await context.set__leave_family(user.user_id)
    return LeaveFamilyResponse(**result)


@router.post('/dissolve', response_model=DissolveFamilyResponse)
async def dissolve_family(
    user: TelegramUser = Depends(get_telegram_user),
) -> DissolveFamilyResponse:
    result = await context.set__dissolve_family(user.user_id)
    return DissolveFamilyResponse(**result)
