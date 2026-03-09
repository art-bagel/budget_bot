from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context


router = APIRouter(prefix='/api/v1/user', tags=['user'])


class UpdateSettingsRequest(BaseModel):
    hints_enabled: bool


class UpdateSettingsResponse(BaseModel):
    hints_enabled: bool


@router.patch('/settings', response_model=UpdateSettingsResponse)
async def update_settings(
    body: UpdateSettingsRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> UpdateSettingsResponse:
    result = await context.set__update_user_settings(
        user_id=user.user_id,
        hints_enabled=body.hints_enabled,
    )
    return UpdateSettingsResponse(**result)
