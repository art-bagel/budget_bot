from uuid import UUID, uuid4
from datetime import date
from decimal import Decimal
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.app.dependencies import CurrentUser, get_current_user
from backend.app.services.deposit_interest import (
    calculate_accrued_interest,
    get_accrual_base_date,
    should_capitalize,
)
from backend.app.storage import context, ledger, reports
from backend.app.services.fx_rates import fx_rates


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
    quantity_exact: str | None = None
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
    comment_is_system: bool = False
    id: int
    position_id: int
    event_type: Literal['open', 'top_up', 'partial_close', 'close', 'income', 'fee', 'adjustment', 'transfer_in', 'transfer_out', 'swap_in', 'swap_out']
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
    received_free: bool = False
    cost_unknown: bool = False
    request_id: UUID | None = None
    investment_account_id: int
    asset_type_code: str
    title: str
    quantity: float | None = None
    amount_in_currency: float
    currency_code: str
    opened_at: date | None = None
    comment: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator('amount_in_currency')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v < 0:
            raise ValueError('Сумма не может быть отрицательной')
        return v

    @field_validator('title', 'asset_type_code')
    @classmethod
    def strings_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Поле не может быть пустым')
        return v.strip()


class TopUpPortfolioPositionRequest(BaseModel):
    resolve_purchase_price: bool = False
    request_id: UUID | None = None
    amount_in_currency: float
    currency_code: str
    quantity: float | None = None
    topped_up_at: date | None = None
    comment: str | None = None

    @field_validator('amount_in_currency')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class ClosePortfolioPositionRequest(BaseModel):
    request_id: UUID | None = None
    close_amount_in_currency: float
    close_currency_code: str
    close_amount_in_base: float | None = None
    closed_at: date | None = None
    comment: str | None = None

    @field_validator('close_amount_in_currency')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class PartialClosePortfolioPositionRequest(BaseModel):
    request_id: UUID | None = None
    return_amount_in_currency: float
    return_currency_code: str
    principal_reduction_in_currency: float
    return_amount_in_base: float | None = None
    closed_quantity: float | None = None
    closed_at: date | None = None
    comment: str | None = None


class RecordPortfolioIncomeRequest(BaseModel):
    request_id: UUID | None = None
    amount: float
    currency_code: str
    amount_in_base: float | None = None
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=50, decimal_places=18, allow_inf_nan=False)
    income_kind: str | None = None
    destination: Literal['account', 'position'] = 'account'
    received_at: date | None = None
    comment: str | None = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v < 0:
            raise ValueError('Сумма не может быть отрицательной')
        return v

    @field_validator('quantity')
    @classmethod
    def quantity_must_be_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError('Количество должно быть положительным')
        return v


class RecordPortfolioIncomeResponse(BaseModel):
    operation_id: int
    amount_in_base: float
    base_currency_code: str


class RecordPortfolioFeeRequest(BaseModel):
    request_id: UUID | None = None
    amount: float
    currency_code: str
    charged_at: date | None = None
    comment: str | None = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


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


class ChangeDepositRateRequest(BaseModel):
    new_rate: float
    effective_date: date | None = None
    comment: str | None = None

    @field_validator('new_rate')
    @classmethod
    def rate_must_be_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError('Ставка не может быть отрицательной')
        return v


class CurrencyReserveBalance(BaseModel):
    currency_code: str
    amount: float
    historical_cost_in_base: float
    base_currency_code: str
    rate: float | None = None
    fetched_at: str | None = None
    market_value_in_base: float | None = None
    unrealized_result_in_base: float | None = None


class PortfolioSummaryItem(BaseModel):
    include_in_statistics: bool = True
    investment_account_id: int
    investment_asset_type: str | None = None
    investment_account_name: str
    investment_account_owner_type: Literal['user', 'family']
    investment_account_owner_name: str
    cash_balance_in_base: float
    cash_market_value_in_base: float | None = None
    cash_valuation_complete: bool = True
    currency_balances: list[CurrencyReserveBalance] = Field(default_factory=list)
    invested_principal_in_base: float
    realized_income_in_base: float
    position_contributed_in_base: float
    position_returned_in_base: float
    net_contributed_in_base: float
    gross_contributed_in_base: float
    gross_withdrawn_in_base: float
    open_positions_count: int


def _enrich_deposit_positions(positions: list[dict]) -> list[dict]:
    """Add calculated accrued_interest to open deposit positions."""
    today = date.today()
    for pos in positions:
        if pos.get('asset_type_code') != 'deposit' or pos.get('status') != 'open':
            continue
        meta = pos.get('metadata') or {}
        if not meta.get('deposit_kind'):
            continue
        opened_at = pos.get('opened_at')
        if isinstance(opened_at, str):
            opened_at = date.fromisoformat(opened_at)
        from_date = get_accrual_base_date(meta, opened_at)
        accrued = calculate_accrued_interest(
            meta, pos.get('amount_in_currency', 0), from_date, today,
        )
        pos['metadata'] = {**meta, 'accrued_interest': accrued}
    return positions


async def _accrue_deposit_interest(
    user_id: int, position: dict, effective_date: date | None = None,
) -> float:
    """Calculate and record accrued interest for a deposit position.

    Returns the accrued amount. If amount is 0, no income event is created.
    """
    meta = position.get('metadata') or {}
    if not meta.get('deposit_kind'):
        return 0.0

    eff_date = effective_date or date.today()
    opened_at = position.get('opened_at')
    if isinstance(opened_at, str):
        opened_at = date.fromisoformat(opened_at)
    from_date = get_accrual_base_date(meta, opened_at)

    if from_date >= eff_date:
        return 0.0

    accrued = calculate_accrued_interest(
        meta, position['amount_in_currency'], from_date, eff_date,
    )
    if accrued <= 0:
        return 0.0

    position_id = position['id']
    currency_code = position['currency_code']

    # Record income event
    await ledger.put__record_portfolio_income(
        user_id=user_id,
        position_id=position_id,
        amount=accrued,
        currency_code=currency_code,
        income_kind='interest',
        destination='position' if should_capitalize(meta) else 'account',
        received_at=eff_date,
        comment='Начисление процентов',
    )

    await context.set__merge_portfolio_position_metadata(
        position_id=position_id,
        metadata_patch={'last_accrual_date': str(eff_date)},
    )

    return accrued


def _is_deposit(position: dict) -> bool:
    meta = position.get('metadata') or {}
    return (
        position.get('asset_type_code') == 'deposit'
        and meta.get('deposit_kind') in ('term_deposit', 'savings_account')
    )


def _is_term_deposit(position: dict) -> bool:
    meta = position.get('metadata') or {}
    return meta.get('deposit_kind') == 'term_deposit'


@router.get('/summary', response_model=List[PortfolioSummaryItem])
async def get_portfolio_summary(
    user: CurrentUser = Depends(get_current_user),
) -> list:
    items = await reports.get__portfolio_summary(user.user_id)
    if any(item.get('investment_asset_type') == 'currency' for item in items):
        try:
            await fx_rates.get(reports, ledger)
        except Exception:
            # Existing snapshots remain usable; missing quotes are marked in the response.
            return items
        items = await reports.get__portfolio_summary(user.user_id)
    return items


@router.get('/analytics')
async def get_portfolio_analytics(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return await reports.get__portfolio_analytics(user.user_id, date_from, date_to)


@router.get('/cost-analytics')
async def get_investment_cost_analytics(
    asset_type: Literal['crypto', 'collectible'],
    account_id: Optional[int] = Query(None),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return await reports.get__investment_cost_analytics(user.user_id, asset_type, account_id)


@router.get('/positions', response_model=List[PortfolioPositionItem])
async def get_portfolio_positions(
    status: Optional[Literal['open', 'closed']] = Query(None),
    investment_account_id: Optional[int] = Query(None),
    user: CurrentUser = Depends(get_current_user),
) -> list:
    positions = await reports.get__portfolio_positions(
        user.user_id,
        status,
        investment_account_id,
    )
    return _enrich_deposit_positions(positions)


async def _post_collection(user_id: int, body: BaseModel, kind: str, day_field: str, position_id: int | None = None) -> PortfolioPositionItem:
    request_id = getattr(body, 'request_id', None)
    if request_id is None:
        raise HTTPException(status_code=400, detail='Обновите форму: отсутствует идентификатор операции')
    payload = body.model_dump(mode='json', exclude={'request_id', day_field, 'asset_type_code', 'received_free'}, exclude_none=True)
    if position_id is not None:
        payload['position_id'] = position_id
    result = await ledger.call_function('budgeting.put__manual_collectible_movement', user_id,
        request_id, kind, payload, getattr(body, day_field))
    return PortfolioPositionItem(**result)


@router.post('/positions', response_model=PortfolioPositionItem)
async def create_portfolio_position(
    body: CreatePortfolioPositionRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    if body.asset_type_code == 'collectible':
        if body.received_free and body.cost_unknown:
            raise HTTPException(status_code=400, detail='Выберите один способ получения')
        if (body.received_free or body.cost_unknown) and body.amount_in_currency != 0:
            raise HTTPException(status_code=400, detail='Бесплатное получение не содержит оплаты')
        return await _post_collection(user.user_id, body, 'collectible_receive' if (body.received_free or body.cost_unknown) else 'collectible_fiat_buy', 'opened_at')
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


class BuyCollectibleWithCryptoRequest(BaseModel):
    request_id: UUID
    investment_account_id: int
    crypto_asset_id: int
    crypto_quantity: Decimal = Field(gt=0, max_digits=50, decimal_places=18, allow_inf_nan=False)
    title: str = Field(min_length=1, max_length=150)
    quantity: float | None = Field(default=None, gt=0)
    opened_at: date | None = None
    comment: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SellCollectibleForCryptoRequest(BaseModel):
    item_quantity: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=8, allow_inf_nan=False)
    request_id: UUID
    crypto_asset_id: int
    crypto_quantity: Decimal = Field(gt=0, max_digits=50, decimal_places=18, allow_inf_nan=False)
    closed_at: date | None = None
    comment: str | None = None


@router.post('/positions/buy-with-crypto', response_model=PortfolioPositionItem)
async def buy_collectible_with_crypto(
    body: BuyCollectibleWithCryptoRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    result = await ledger.call_function(
        'budgeting.put__manual_collectible_movement', user.user_id, body.request_id, 'collectible_buy',
        body.model_dump(mode='json', exclude={'request_id', 'opened_at'}, exclude_none=True), body.opened_at,
    )
    return PortfolioPositionItem(**result)


class ChargeCollectibleCoinRequest(BaseModel):
    resolve_purchase_price: bool = False
    request_id: UUID
    crypto_asset_id: int
    crypto_quantity: Decimal = Field(gt=0, max_digits=50, decimal_places=18, allow_inf_nan=False)
    allocation_position_ids: list[int] | None = Field(default=None, min_length=1, max_length=1000)
    kind: Literal['fee', 'topup']
    operated_at: date | None = None
    comment: str | None = None


@router.post('/positions/{position_id}/coin-charge', response_model=PortfolioPositionItem)
async def charge_collectible_coin(position_id: int, body: ChargeCollectibleCoinRequest,
    user: CurrentUser = Depends(get_current_user)) -> PortfolioPositionItem:
    result = await ledger.call_function('budgeting.put__manual_collectible_movement', user.user_id, body.request_id,
        'collectible_coin_' + body.kind,
        {**body.model_dump(mode='json', exclude={'request_id', 'kind', 'operated_at'}, exclude_none=True), 'position_id': position_id}, body.operated_at)
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/sell-for-crypto', response_model=PortfolioPositionItem)
async def sell_collectible_for_crypto(
    position_id: int,
    body: SellCollectibleForCryptoRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    result = await ledger.call_function(
        'budgeting.put__manual_collectible_movement', user.user_id, body.request_id, 'collectible_sell',
        {**body.model_dump(mode='json', exclude={'request_id', 'closed_at'}, exclude_none=True), 'position_id': position_id}, body.closed_at,
    )
    return PortfolioPositionItem(**result)


@router.post('/positions/{position_id}/close', response_model=PortfolioPositionItem)
async def close_portfolio_position(
    position_id: int,
    body: ClosePortfolioPositionRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    # For deposits: accrue interest before closing
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if position and position['asset_type_code'] == 'collectible':
        return await _post_collection(user.user_id, body, 'collectible_fiat_close', 'closed_at', position_id)
    if position and _is_deposit(position):
        await _accrue_deposit_interest(user.user_id, position, body.closed_at)

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
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    # Term deposits cannot be partially closed
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if position and position['asset_type_code'] == 'collectible':
        return await _post_collection(user.user_id, body, 'collectible_fiat_partial', 'closed_at', position_id)
    if position and _is_term_deposit(position):
        raise HTTPException(status_code=400, detail='Частичное снятие со вклада невозможно')
    # For savings accounts: accrue interest before partial close
    if position and _is_deposit(position):
        await _accrue_deposit_interest(user.user_id, position, body.closed_at)

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
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    # Term deposits cannot be topped up
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if position and position['asset_type_code'] == 'collectible':
        return await _post_collection(user.user_id, body, 'collectible_fiat_topup', 'topped_up_at', position_id)
    if position and _is_term_deposit(position):
        raise HTTPException(status_code=400, detail='Пополнение вклада невозможно')
    # For savings accounts: accrue interest before top-up
    if position and _is_deposit(position):
        await _accrue_deposit_interest(user.user_id, position, body.topped_up_at)

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
    user: CurrentUser = Depends(get_current_user),
) -> RecordPortfolioIncomeResponse:
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if position and position.get('asset_type_code') == 'crypto':
        result = await ledger.put__manual_crypto_movement(
            user_id=user.user_id, request_id=body.request_id or uuid4(), kind='position_income',
            payload={'position_id': position_id, **body.model_dump(mode='json', exclude_none=True,
                exclude={'request_id', 'received_at'})}, operated_at=body.received_at,
        )
        return RecordPortfolioIncomeResponse(**result)
    result = await ledger.put__record_portfolio_income(
        user_id=user.user_id,
        position_id=position_id,
        amount=body.amount,
        currency_code=body.currency_code,
        amount_in_base=body.amount_in_base,
        quantity=body.quantity,
        income_kind=body.income_kind,
        destination=body.destination,
        received_at=body.received_at,
        comment=body.comment,
    )
    return RecordPortfolioIncomeResponse(**result)


@router.post('/positions/{position_id}/fee', response_model=PortfolioPositionItem)
async def record_portfolio_fee(
    position_id: int,
    body: RecordPortfolioFeeRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if position and position['asset_type_code'] == 'collectible':
        return await _post_collection(user.user_id, body, 'collectible_fiat_fee', 'charged_at', position_id)
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
    user: CurrentUser = Depends(get_current_user),
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
    user: CurrentUser = Depends(get_current_user),
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
    user: CurrentUser = Depends(get_current_user),
) -> list:
    return await reports.get__portfolio_events(user.user_id, position_id)


@router.post('/positions/{position_id}/change-rate', response_model=PortfolioPositionItem)
async def change_deposit_rate(
    position_id: int,
    body: ChangeDepositRateRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    position = await reports.get__portfolio_position(user.user_id, position_id)
    if not position:
        raise HTTPException(status_code=404, detail='Позиция не найдена')
    if not _is_deposit(position):
        raise HTTPException(status_code=400, detail='Смена ставки доступна только для депозитов')
    if position.get('status') != 'open':
        raise HTTPException(status_code=400, detail='Позиция закрыта')

    effective = body.effective_date or date.today()

    # Accrue interest at old rate up to effective_date
    await _accrue_deposit_interest(user.user_id, position, effective)

    # Update rate in metadata
    await context.set__merge_portfolio_position_metadata(
        position_id=position_id,
        metadata_patch={
            'interest_rate': body.new_rate,
            'last_accrual_date': str(effective),
        },
    )

    # Return updated position
    updated = await reports.get__portfolio_position(user.user_id, position_id)
    return PortfolioPositionItem(**updated)


class CollectibleAcquiredAtRequest(BaseModel):
    request_id: UUID
    acquired_at: date | None = None


@router.post('/positions/{position_id}/acquired-at', response_model=PortfolioPositionItem)
async def set_collectible_acquired_at(
    position_id: int,
    body: CollectibleAcquiredAtRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    result = await ledger.call_function('budgeting.put__manual_collectible_movement', user.user_id,
        body.request_id, 'collectible_details', {'position_id': position_id,
        'acquired_at': body.acquired_at.isoformat() if body.acquired_at else None}, None)
    return PortfolioPositionItem(**result)


class CollectibleDetailsRequest(BaseModel):
    request_id: UUID
    title: str = Field(min_length=1, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)
    acquired_at: date | None = None
    item_kind: str
    item_link: str | None = Field(default=None, max_length=500)
    image_url: str | None = Field(default=None, max_length=1000)
    item_attributes: dict[str, str] = Field(default_factory=dict)


@router.post('/positions/{position_id}/details', response_model=PortfolioPositionItem)
async def edit_collectible_details(
    position_id: int, body: CollectibleDetailsRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PortfolioPositionItem:
    payload = body.model_dump(mode='json', exclude={'request_id'})
    payload['position_id'] = position_id
    result = await ledger.call_function('budgeting.put__manual_collectible_movement', user.user_id,
        body.request_id, 'collectible_details', payload, None)
    return PortfolioPositionItem(**result)
