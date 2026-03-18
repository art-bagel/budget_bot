from datetime import date
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, ledger, reports


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
    event_type: Literal['open', 'top_up', 'partial_close', 'close', 'income', 'fee', 'adjustment']
    event_at: date
    quantity: float | None = None
    amount: float | None = None
    currency_code: str | None = None
    linked_operation_id: int | None = None
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


class TopUpPortfolioPositionRequest(BaseModel):
    amount_in_currency: float
    currency_code: str
    quantity: float | None = None
    topped_up_at: date | None = None
    comment: str | None = None


class ClosePortfolioPositionRequest(BaseModel):
    close_amount_in_currency: float
    close_currency_code: str
    close_amount_in_base: float | None = None
    closed_at: date | None = None
    comment: str | None = None


class PartialClosePortfolioPositionRequest(BaseModel):
    return_amount_in_currency: float
    return_currency_code: str
    principal_reduction_in_currency: float
    return_amount_in_base: float | None = None
    closed_quantity: float | None = None
    closed_at: date | None = None
    comment: str | None = None


class RecordPortfolioIncomeRequest(BaseModel):
    amount: float
    currency_code: str
    amount_in_base: float | None = None
    income_kind: str | None = None
    received_at: date | None = None
    comment: str | None = None


class RecordPortfolioIncomeResponse(BaseModel):
    operation_id: int
    amount_in_base: float
    base_currency_code: str


class RecordPortfolioFeeRequest(BaseModel):
    amount: float
    currency_code: str
    charged_at: date | None = None
    comment: str | None = None


class DeletePortfolioPositionResponse(BaseModel):
    status: Literal['deleted']
    position_id: int
    operation_id: int


class CancelPortfolioIncomeRequest(BaseModel):
    comment: str | None = None


class CancelPortfolioIncomeResponse(BaseModel):
    status: Literal['cancelled']
    event_id: int
    operation_id: int


class PortfolioSummaryItem(BaseModel):
    investment_account_id: int
    investment_account_name: str
    investment_account_owner_type: Literal['user', 'family']
    investment_account_owner_name: str
    cash_balance_in_base: float
    invested_principal_in_base: float
    realized_income_in_base: float
    open_positions_count: int


@router.get('/summary', response_model=List[PortfolioSummaryItem])
async def get_portfolio_summary(
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__portfolio_summary(user.user_id)


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
        close_amount_in_base=body.close_amount_in_base,
        closed_at=body.closed_at,
        comment=body.comment,
    )
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/partial-close', response_model=PortfolioPositionItem)
async def partial_close_portfolio_position(
    position_id: int,
    body: PartialClosePortfolioPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> PortfolioPositionItem:
    result = await context.put__partial_close_portfolio_position(
        user_id=user.user_id,
        position_id=position_id,
        return_amount_in_currency=body.return_amount_in_currency,
        return_currency_code=body.return_currency_code,
        principal_reduction_in_currency=body.principal_reduction_in_currency,
        return_amount_in_base=body.return_amount_in_base,
        closed_quantity=body.closed_quantity,
        closed_at=body.closed_at,
        comment=body.comment,
    )
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/top-up', response_model=PortfolioPositionItem)
async def top_up_portfolio_position(
    position_id: int,
    body: TopUpPortfolioPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> PortfolioPositionItem:
    result = await context.put__top_up_portfolio_position(
        user_id=user.user_id,
        position_id=position_id,
        amount_in_currency=body.amount_in_currency,
        currency_code=body.currency_code,
        quantity=body.quantity,
        topped_up_at=body.topped_up_at,
        comment=body.comment,
    )
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/income', response_model=RecordPortfolioIncomeResponse)
async def record_portfolio_income(
    position_id: int,
    body: RecordPortfolioIncomeRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RecordPortfolioIncomeResponse:
    result = await ledger.put__record_portfolio_income(
        user_id=user.user_id,
        position_id=position_id,
        amount=body.amount,
        currency_code=body.currency_code,
        amount_in_base=body.amount_in_base,
        income_kind=body.income_kind,
        received_at=body.received_at,
        comment=body.comment,
    )
    return RecordPortfolioIncomeResponse(**result)


@router.post('/positions/{position_id}/fee', response_model=PortfolioPositionItem)
async def record_portfolio_fee(
    position_id: int,
    body: RecordPortfolioFeeRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> PortfolioPositionItem:
    result = await context.put__record_portfolio_fee(
        user_id=user.user_id,
        position_id=position_id,
        amount=body.amount,
        currency_code=body.currency_code,
        charged_at=body.charged_at,
        comment=body.comment,
    )
    return PortfolioPositionItem(**result)


@router.delete('/positions/{position_id}', response_model=DeletePortfolioPositionResponse)
async def delete_portfolio_position(
    position_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> DeletePortfolioPositionResponse:
    result = await context.put__delete_portfolio_position(
        user_id=user.user_id,
        position_id=position_id,
    )
    return DeletePortfolioPositionResponse(**result)


@router.post('/events/{event_id}/cancel', response_model=CancelPortfolioIncomeResponse)
async def cancel_portfolio_income(
    event_id: int,
    body: CancelPortfolioIncomeRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CancelPortfolioIncomeResponse:
    result = await context.put__cancel_portfolio_income(
        user_id=user.user_id,
        event_id=event_id,
        comment=body.comment,
    )
    return CancelPortfolioIncomeResponse(**result)


@router.get('/positions/{position_id}/events', response_model=List[PortfolioEventItem])
async def get_portfolio_events(
    position_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__portfolio_events(user.user_id, position_id)
