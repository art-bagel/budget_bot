from datetime import date
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/portfolio', tags=['portfolio'])


class PortfolioPositionItem(BaseModel):
    id: int
    investment_account_id: int
    investment_account_name: str
    investment_account_owner_type: Literal['user', 'family']
    investment_account_owner_name: str
    asset_type_code: str
    title: str
    status: Literal['open', 'closed']
    quantity: float | None = None
    amount_in_currency: float
    currency_code: str
    opened_at: date
    closed_at: date | None = None
    close_amount_in_currency: float | None = None
    close_currency_code: str | None = None
    comment: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int
    created_at: str


class PortfolioEventItem(BaseModel):
    id: int
    position_id: int
    event_type: Literal['open', 'close']
    event_at: date
    quantity: float | None = None
    amount: float | None = None
    currency_code: str | None = None
    comment: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int
    created_at: str


class CreatePortfolioPositionRequest(BaseModel):
    investment_account_id: int
    asset_type_code: str
    title: str
    quantity: float | None = None
    amount_in_currency: float
    currency_code: str
    opened_at: date | None = None
    comment: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ClosePortfolioPositionRequest(BaseModel):
    close_amount_in_currency: float
    close_currency_code: str
    closed_at: date | None = None
    comment: str | None = None


@router.get('/positions', response_model=List[PortfolioPositionItem])
async def get_portfolio_positions(
    status: Optional[Literal['open', 'closed']] = Query(None),
    investment_account_id: Optional[int] = Query(None),
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__portfolio_positions(
        user.user_id,
        status,
        investment_account_id,
    )


@router.post('/positions', response_model=PortfolioPositionItem)
async def create_portfolio_position(
    body: CreatePortfolioPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> PortfolioPositionItem:
    result = await context.put__create_portfolio_position(
        user_id=user.user_id,
        investment_account_id=body.investment_account_id,
        asset_type_code=body.asset_type_code,
        title=body.title,
        quantity=body.quantity,
        amount_in_currency=body.amount_in_currency,
        currency_code=body.currency_code,
        opened_at=body.opened_at,
        comment=body.comment,
        metadata=body.metadata,
    )
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/close', response_model=PortfolioPositionItem)
async def close_portfolio_position(
    position_id: int,
    body: ClosePortfolioPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> PortfolioPositionItem:
    result = await context.put__close_portfolio_position(
        user_id=user.user_id,
        position_id=position_id,
        close_amount_in_currency=body.close_amount_in_currency,
        close_currency_code=body.close_currency_code,
        closed_at=body.closed_at,
        comment=body.comment,
    )
    return PortfolioPositionItem(**result)


@router.get('/positions/{position_id}/events', response_model=List[PortfolioEventItem])
async def get_portfolio_events(
    position_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__portfolio_events(user.user_id, position_id)
