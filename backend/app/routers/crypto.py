from datetime import date
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import ledger, reports


router = APIRouter(prefix='/api/v1/crypto', tags=['crypto'])


class CryptoAssetItem(BaseModel):
    id: int
    symbol: str
    name: str
    network_code: str
    contract_address: Optional[str] = None
    decimals: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class UpsertCryptoAssetRequest(BaseModel):
    symbol: str
    name: Optional[str] = None
    network_code: str = 'manual'
    contract_address: Optional[str] = None
    decimals: int = 8
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator('symbol')
    @classmethod
    def symbol_must_not_be_empty(cls, v: str) -> str:
        value = v.strip().upper()
        if not value:
            raise ValueError('Символ не может быть пустым')
        return value


class CryptoOperationResponse(BaseModel):
    operation_id: int
    cost_base: Optional[float] = None
    consumed_cost_base: Optional[float] = None
    realized_fx_result_in_base: Optional[float] = None
    expense_cost_in_base: Optional[float] = None
    amount_in_base: Optional[float] = None
    principal_amount_in_base: Optional[float] = None
    realized_result_in_base: Optional[float] = None
    position_id: Optional[int] = None
    base_currency_code: str


class TransferCryptoToInvestmentRequest(BaseModel):
    bank_account_id: int
    investment_account_id: int
    crypto_asset_id: int
    amount: float
    market_value_in_base: Optional[float] = None
    position_id: Optional[int] = None
    title: Optional[str] = None
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class TransferCryptoFromInvestmentRequest(BaseModel):
    position_id: int
    bank_account_id: int
    amount: float
    value_in_base: float
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount', 'value_in_base')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class CryptoProtocolPositionItem(BaseModel):
    id: int
    investment_account_id: int
    investment_account_name: str
    owner_type: Literal['user', 'family']
    crypto_asset_id: Optional[int] = None
    protocol_name: str
    position_type: Literal['staking', 'lending', 'liquidity_pool', 'vault', 'other']
    status: Literal['open', 'closed']
    network_code: Optional[str] = None
    asset_symbol: str
    quantity: Optional[float] = None
    cost_basis_in_base: float
    current_quantity: Optional[float] = None
    current_value_in_base: float
    rewards_claimed_in_base: float
    rewards_unclaimed_in_base: float
    deposited_at: date
    withdrawn_at: Optional[date] = None
    comment: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int
    created_at: str
    updated_at: str


class CreateCryptoProtocolPositionRequest(BaseModel):
    investment_account_id: int
    protocol_name: str
    position_type: Literal['staking', 'lending', 'liquidity_pool', 'vault', 'other']
    asset_symbol: str
    quantity: Optional[float] = None
    cost_basis_in_base: float = 0
    current_quantity: Optional[float] = None
    current_value_in_base: float = 0
    rewards_claimed_in_base: float = 0
    rewards_unclaimed_in_base: float = 0
    crypto_asset_id: Optional[int] = None
    network_code: Optional[str] = None
    deposited_at: Optional[date] = None
    comment: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateCryptoProtocolPositionRequest(BaseModel):
    quantity: Optional[float] = None
    current_quantity: Optional[float] = None
    current_value_in_base: Optional[float] = None
    rewards_claimed_in_base: Optional[float] = None
    rewards_unclaimed_in_base: Optional[float] = None
    comment: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class CloseCryptoProtocolPositionRequest(BaseModel):
    withdrawn_at: Optional[date] = None
    current_quantity: Optional[float] = None
    current_value_in_base: Optional[float] = None
    comment: Optional[str] = None


@router.get('/assets', response_model=List[CryptoAssetItem])
async def get_crypto_assets(
    _user: TelegramUser = Depends(get_telegram_user),
) -> List[CryptoAssetItem]:
    items = await reports.get__crypto_assets()
    return [CryptoAssetItem(**item) for item in items]


@router.post('/assets', response_model=CryptoAssetItem)
async def upsert_crypto_asset(
    body: UpsertCryptoAssetRequest,
    _user: TelegramUser = Depends(get_telegram_user),
) -> CryptoAssetItem:
    result = await ledger.put__upsert_crypto_asset(
        symbol=body.symbol,
        name=body.name,
        network_code=body.network_code,
        contract_address=body.contract_address,
        decimals=body.decimals,
        metadata=body.metadata,
    )
    return CryptoAssetItem(**result)


@router.post('/transfer-to-investment', response_model=CryptoOperationResponse)
async def transfer_crypto_to_investment(
    body: TransferCryptoToInvestmentRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoOperationResponse:
    result = await ledger.put__transfer_crypto_to_investment(
        user_id=user.user_id,
        bank_account_id=body.bank_account_id,
        investment_account_id=body.investment_account_id,
        crypto_asset_id=body.crypto_asset_id,
        amount=body.amount,
        market_value_in_base=body.market_value_in_base,
        position_id=body.position_id,
        title=body.title,
        comment=body.comment,
        operated_at=body.operated_at,
    )
    return CryptoOperationResponse(**result)


@router.post('/transfer-from-investment', response_model=CryptoOperationResponse)
async def transfer_crypto_from_investment(
    body: TransferCryptoFromInvestmentRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoOperationResponse:
    result = await ledger.put__transfer_crypto_from_investment(
        user_id=user.user_id,
        position_id=body.position_id,
        bank_account_id=body.bank_account_id,
        amount=body.amount,
        value_in_base=body.value_in_base,
        comment=body.comment,
        operated_at=body.operated_at,
    )
    return CryptoOperationResponse(**result)


@router.get('/protocol-positions', response_model=List[CryptoProtocolPositionItem])
async def get_crypto_protocol_positions(
    investment_account_id: Optional[int] = Query(None),
    status: Optional[Literal['open', 'closed']] = Query(None),
    user: TelegramUser = Depends(get_telegram_user),
) -> List[CryptoProtocolPositionItem]:
    items = await reports.get__crypto_protocol_positions(
        user_id=user.user_id,
        investment_account_id=investment_account_id,
        status=status,
    )
    return [CryptoProtocolPositionItem(**item) for item in items]


@router.post('/protocol-positions', response_model=CryptoProtocolPositionItem)
async def create_crypto_protocol_position(
    body: CreateCryptoProtocolPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoProtocolPositionItem:
    result = await ledger.put__create_crypto_protocol_position(
        user_id=user.user_id,
        investment_account_id=body.investment_account_id,
        protocol_name=body.protocol_name,
        position_type=body.position_type,
        asset_symbol=body.asset_symbol,
        quantity=body.quantity,
        cost_basis_in_base=body.cost_basis_in_base,
        current_quantity=body.current_quantity,
        current_value_in_base=body.current_value_in_base,
        rewards_claimed_in_base=body.rewards_claimed_in_base,
        rewards_unclaimed_in_base=body.rewards_unclaimed_in_base,
        crypto_asset_id=body.crypto_asset_id,
        network_code=body.network_code,
        deposited_at=body.deposited_at,
        comment=body.comment,
        metadata=body.metadata,
    )
    return CryptoProtocolPositionItem(**result)


@router.patch('/protocol-positions/{position_id}', response_model=CryptoProtocolPositionItem)
async def update_crypto_protocol_position(
    position_id: int,
    body: UpdateCryptoProtocolPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoProtocolPositionItem:
    result = await ledger.set__update_crypto_protocol_position(
        user_id=user.user_id,
        position_id=position_id,
        quantity=body.quantity,
        current_quantity=body.current_quantity,
        current_value_in_base=body.current_value_in_base,
        rewards_claimed_in_base=body.rewards_claimed_in_base,
        rewards_unclaimed_in_base=body.rewards_unclaimed_in_base,
        comment=body.comment,
        metadata=body.metadata,
    )
    return CryptoProtocolPositionItem(**result)


@router.post('/protocol-positions/{position_id}/close', response_model=CryptoProtocolPositionItem)
async def close_crypto_protocol_position(
    position_id: int,
    body: CloseCryptoProtocolPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoProtocolPositionItem:
    result = await ledger.set__close_crypto_protocol_position(
        user_id=user.user_id,
        position_id=position_id,
        withdrawn_at=body.withdrawn_at,
        current_quantity=body.current_quantity,
        current_value_in_base=body.current_value_in_base,
        comment=body.comment,
    )
    return CryptoProtocolPositionItem(**result)

