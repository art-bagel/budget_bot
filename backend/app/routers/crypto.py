from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import ledger, reports


router = APIRouter(prefix='/api/v1/crypto', tags=['crypto'])

COINGECKO_IDS_BY_SYMBOL = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'TON': 'the-open-network',
    'BNB': 'binancecoin',
    'SOL': 'solana',
    'TRX': 'tron',
    'DOGE': 'dogecoin',
    'ADA': 'cardano',
    'XRP': 'ripple',
    'DOT': 'polkadot',
    'MATIC': 'matic-network',
}
SUPPORTED_PRICE_CURRENCIES = {'rub', 'usd', 'eur'}
_PRICE_CACHE: dict[tuple[str, str], tuple[datetime, float]] = {}
_PRICE_CACHE_TTL = timedelta(minutes=2)


class CryptoAssetItem(BaseModel):
    id: int
    symbol: str
    name: str
    network_code: str
    contract_address: Optional[str] = None
    decimals: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class CryptoPriceItem(BaseModel):
    crypto_asset_id: int
    symbol: str
    vs_currency: str
    price: float
    source: str
    fetched_at: str
    is_stale: bool = False
    stale_age_seconds: Optional[int] = None


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
    position_id: Optional[int] = None
    base_currency_code: str


class TransferCryptoToInvestmentRequest(BaseModel):
    bank_account_id: int
    investment_account_id: int
    crypto_asset_id: int
    amount: float
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


class TransferCryptoBetweenInvestmentAccountsRequest(BaseModel):
    position_id: int
    target_investment_account_id: int
    amount: float
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class SwapCryptoInvestmentAssetRequest(BaseModel):
    position_id: int
    from_amount: float
    to_crypto_asset_id: int
    to_amount: float
    target_investment_account_id: Optional[int] = None
    comment: Optional[str] = None
    operated_at: Optional[date] = None
    value_in_base: Optional[float] = None

    @field_validator('from_amount', 'to_amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('value_in_base')
    @classmethod
    def value_must_be_positive_if_provided(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError('Стоимость должна быть положительной')
        return v


class CryptoAccountAssetSummary(BaseModel):
    crypto_asset_id: int
    symbol: str
    name: Optional[str] = None
    network_code: Optional[str] = None
    contract_address: Optional[str] = None
    decimals: int = 8
    asset_metadata: dict[str, Any] = Field(default_factory=dict)
    position_id: int
    quantity: float
    opened_at: Optional[date] = None
    total_entry_value_in_base: float
    total_consumed_cost_basis: float
    remaining_cost_basis: float
    avg_cost_per_unit: float
    realized_pnl_lifetime_in_base: float
    last_event_at: Optional[date] = None


class CryptoAssetEntry(BaseModel):
    event_id: int
    event_type: str
    event_at: date
    quantity: Optional[float] = None
    amount: Optional[float] = None
    currency_code: Optional[str] = None
    comment: Optional[str] = None
    linked_operation_id: Optional[int] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    entry_value_in_base: Optional[float] = None
    value_in_base: Optional[float] = None
    consumed_cost_basis: Optional[float] = None
    realized_in_base: Optional[float] = None
    source_kind: Optional[str] = None
    target_kind: Optional[str] = None
    is_legacy_no_basis: bool = False


class CryptoAssetDetail(CryptoAccountAssetSummary):
    investment_account_id: int
    investment_account_name: str
    entries: List[CryptoAssetEntry] = Field(default_factory=list)


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
    source_position_id: Optional[int] = None


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
    return_quantity: Optional[float] = None
    return_value_in_base: Optional[float] = None
    comment: Optional[str] = None

    @field_validator('return_quantity', 'return_value_in_base')
    @classmethod
    def positive_if_provided(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class PartialCloseCryptoProtocolPositionRequest(BaseModel):
    principal_qty: float = 0
    rewards_qty: float = 0
    principal_value_in_base: Optional[float] = None
    rewards_value_in_base: Optional[float] = None
    returned_at: Optional[date] = None
    comment: Optional[str] = None

    @field_validator('principal_qty', 'rewards_qty')
    @classmethod
    def non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError('Количество не может быть отрицательным')
        return v

    @field_validator('principal_value_in_base', 'rewards_value_in_base')
    @classmethod
    def value_non_negative(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError('Оценка в базовой валюте не может быть отрицательной')
        return v


def _coingecko_id_for_asset(asset: dict[str, Any]) -> str | None:
    metadata = asset.get('metadata') or {}
    explicit_id = metadata.get('coingecko_id') or metadata.get('coin_gecko_id')
    if isinstance(explicit_id, str) and explicit_id.strip():
        return explicit_id.strip().lower()
    return COINGECKO_IDS_BY_SYMBOL.get(str(asset.get('symbol') or '').upper())


@router.get('/assets', response_model=List[CryptoAssetItem])
async def get_crypto_assets(
    _user: TelegramUser = Depends(get_telegram_user),
) -> List[CryptoAssetItem]:
    items = await reports.get__crypto_assets()
    return [CryptoAssetItem(**item) for item in items]


@router.get('/prices', response_model=List[CryptoPriceItem])
async def get_crypto_prices(
    asset_ids: str = Query(..., min_length=1),
    vs_currency: str = Query('rub', min_length=3, max_length=3),
    _user: TelegramUser = Depends(get_telegram_user),
) -> List[CryptoPriceItem]:
    requested_ids = {
        int(part)
        for part in asset_ids.split(',')
        if part.strip().isdigit()
    }
    if not requested_ids:
        return []

    normalized_vs = vs_currency.strip().lower()
    if normalized_vs not in SUPPORTED_PRICE_CURRENCIES:
        normalized_vs = 'rub'

    assets = [
        item for item in await reports.get__crypto_assets()
        if int(item['id']) in requested_ids
    ]
    id_to_assets: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        coingecko_id = _coingecko_id_for_asset(asset)
        if coingecko_id:
            id_to_assets.setdefault(coingecko_id, []).append(asset)

    if not id_to_assets:
        return []

    now = datetime.now(timezone.utc)
    stale_ids = [
        coingecko_id
        for coingecko_id in id_to_assets
        if (coingecko_id, normalized_vs) not in _PRICE_CACHE
        or now - _PRICE_CACHE[(coingecko_id, normalized_vs)][0] > _PRICE_CACHE_TTL
    ]

    if stale_ids:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(
                    'https://api.coingecko.com/api/v3/simple/price',
                    params={
                        'ids': ','.join(stale_ids),
                        'vs_currencies': normalized_vs,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            for coingecko_id in stale_ids:
                raw_price = (payload.get(coingecko_id) or {}).get(normalized_vs)
                if isinstance(raw_price, (int, float)) and raw_price > 0:
                    _PRICE_CACHE[(coingecko_id, normalized_vs)] = (now, float(raw_price))
        except httpx.HTTPError:
            # Keep whatever is in cache; below we'll surface it as stale.
            pass

    result: list[CryptoPriceItem] = []
    for coingecko_id, mapped_assets in id_to_assets.items():
        cached = _PRICE_CACHE.get((coingecko_id, normalized_vs))
        if not cached:
            continue
        cached_at, price = cached
        age = now - cached_at
        is_stale = age > _PRICE_CACHE_TTL
        for asset in mapped_assets:
            result.append(CryptoPriceItem(
                crypto_asset_id=int(asset['id']),
                symbol=str(asset['symbol']),
                vs_currency=normalized_vs.upper(),
                price=price,
                source='coingecko_stale' if is_stale else 'coingecko',
                fetched_at=cached_at.isoformat(),
                is_stale=is_stale,
                stale_age_seconds=int(age.total_seconds()) if is_stale else None,
            ))
    return result


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


@router.get(
    '/accounts/{investment_account_id}/assets',
    response_model=List[CryptoAccountAssetSummary],
)
async def get_crypto_account_assets(
    investment_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> List[CryptoAccountAssetSummary]:
    items = await reports.get__crypto_account_assets(user.user_id, investment_account_id)
    return [CryptoAccountAssetSummary(**item) for item in items]


@router.get(
    '/accounts/{investment_account_id}/assets/{crypto_asset_id}',
    response_model=Optional[CryptoAssetDetail],
)
async def get_crypto_asset_detail(
    investment_account_id: int,
    crypto_asset_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> Optional[CryptoAssetDetail]:
    item = await reports.get__crypto_asset_detail(
        user.user_id, investment_account_id, crypto_asset_id,
    )
    return CryptoAssetDetail(**item) if item else None


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


@router.post('/transfer-between-investment-accounts', response_model=CryptoOperationResponse)
async def transfer_crypto_between_investment_accounts(
    body: TransferCryptoBetweenInvestmentAccountsRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoOperationResponse:
    result = await ledger.put__transfer_crypto_between_investment_accounts(
        user_id=user.user_id,
        position_id=body.position_id,
        target_investment_account_id=body.target_investment_account_id,
        amount=body.amount,
        comment=body.comment,
        operated_at=body.operated_at,
    )
    return CryptoOperationResponse(**result)


@router.post('/swap-investment-asset', response_model=CryptoOperationResponse)
async def swap_crypto_investment_asset(
    body: SwapCryptoInvestmentAssetRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoOperationResponse:
    result = await ledger.put__swap_crypto_investment_asset(
        user_id=user.user_id,
        position_id=body.position_id,
        from_amount=body.from_amount,
        to_crypto_asset_id=body.to_crypto_asset_id,
        to_amount=body.to_amount,
        target_investment_account_id=body.target_investment_account_id,
        comment=body.comment,
        operated_at=body.operated_at,
        value_in_base=body.value_in_base,
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
        source_position_id=body.source_position_id,
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
        return_quantity=body.return_quantity,
        return_value_in_base=body.return_value_in_base,
    )
    return CryptoProtocolPositionItem(**result)


@router.post(
    '/protocol-positions/{position_id}/partial-close',
    response_model=CryptoProtocolPositionItem,
)
async def partial_close_crypto_protocol_position(
    position_id: int,
    body: PartialCloseCryptoProtocolPositionRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CryptoProtocolPositionItem:
    if body.principal_qty == 0 and body.rewards_qty == 0:
        raise HTTPException(
            status_code=400,
            detail='Нужно указать principal_qty или rewards_qty',
        )
    result = await ledger.put__partial_close_crypto_protocol_position(
        user_id=user.user_id,
        position_id=position_id,
        principal_qty=body.principal_qty,
        rewards_qty=body.rewards_qty,
        principal_value_in_base=body.principal_value_in_base,
        rewards_value_in_base=body.rewards_value_in_base,
        returned_at=body.returned_at,
        comment=body.comment,
    )
    return CryptoProtocolPositionItem(**result)
