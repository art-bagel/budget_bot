from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import ledger, reports


router = APIRouter(prefix='/api/v1/operations', tags=['operations'])


class RecordIncomeRequest(BaseModel):
    bank_account_id: int
    income_source_id: Optional[int] = None
    amount: float
    currency_code: str
    budget_amount_in_base: Optional[float] = None
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return v


class RecordIncomeResponse(BaseModel):
    operation_id: int
    budget_amount_in_base: float
    base_currency_code: str


class RecordExpenseRequest(BaseModel):
    bank_account_id: int
    category_id: int
    amount: float
    currency_code: str
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return v


class RecordExpenseResponse(BaseModel):
    operation_id: int
    expense_cost_in_base: float
    base_currency_code: str


class ExchangeCurrencyRequest(BaseModel):
    bank_account_id: int
    from_currency_code: str
    from_amount: float
    to_currency_code: str
    to_amount: float
    comment: Optional[str] = None

    @field_validator('from_amount', 'to_amount')
    @classmethod
    def amounts_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('from_currency_code', 'to_currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return v


class ExchangeCurrencyResponse(BaseModel):
    operation_id: int
    effective_rate: float
    realized_fx_result_in_base: float
    base_currency_code: str


class AllocateBudgetRequest(BaseModel):
    from_category_id: int
    to_category_id: int
    amount_in_base: float
    comment: Optional[str] = None

    @field_validator('amount_in_base')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class AllocateBudgetResponse(BaseModel):
    operation_id: int


class AllocateGroupBudgetRequest(BaseModel):
    from_category_id: int
    group_id: int
    amount_in_base: float
    comment: Optional[str] = None

    @field_validator('amount_in_base')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v


class AllocateGroupBudgetResponse(BaseModel):
    operation_id: int
    members_count: int


class AccountTransferRequest(BaseModel):
    from_account_id: int
    to_account_id: int
    currency_code: str
    amount: float
    comment: Optional[str] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return v


class AccountTransferResponse(BaseModel):
    operation_id: int
    amount_in_base: float
    base_currency_code: str


class ReverseOperationRequest(BaseModel):
    operation_id: int
    comment: Optional[str] = None


class ReverseOperationResponse(BaseModel):
    reversal_operation_id: int
    reversed_operation_id: int


class OperationBankEntry(BaseModel):
    bank_account_id: int
    bank_account_name: Optional[str] = None
    bank_account_owner_type: Optional[str] = None
    bank_account_kind: Optional[str] = None
    currency_code: str
    amount: float


class OperationBudgetEntry(BaseModel):
    category_id: int
    category_name: str
    category_kind: str
    category_owner_type: str
    currency_code: str
    amount: float


class OperationHistoryItem(BaseModel):
    operation_id: int
    type: str
    comment: Optional[str] = None
    created_at: str
    reversal_of_operation_id: Optional[int] = None
    has_reversal: bool = False
    actor_user_id: int
    actor_username: Optional[str] = None
    owner_type: str
    owner_user_id: Optional[int] = None
    owner_family_id: Optional[int] = None
    income_source_name: Optional[str] = None
    bank_entries: List[OperationBankEntry]
    budget_entries: List[OperationBudgetEntry]


class OperationHistoryResponse(BaseModel):
    items: List[OperationHistoryItem]
    total_count: int
    limit: int
    offset: int


class OperationAnalyticsItem(BaseModel):
    entry_key: str
    label: str
    owner_type: Literal['user', 'family']
    amount: float
    operations_count: int


class OperationAnalyticsMonth(BaseModel):
    period_start: str
    amount: float
    is_selected: bool


class OperationAnalyticsResponse(BaseModel):
    period_start: str
    period_mode: Literal['week', 'month', 'year']
    operation_type: Literal['expense', 'income']
    owner_scope: Literal['all', 'user', 'family']
    base_currency_code: str
    has_family: bool
    total_amount: float
    total_operations: int
    items: List[OperationAnalyticsItem]
    periods: List[OperationAnalyticsMonth]


def parse_anchor_date(anchor_date: Optional[str]) -> Optional[date]:
    if anchor_date is None:
        return None

    value = anchor_date.strip()
    if not value:
        return None

    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Неверный формат даты. Используй YYYY-MM-DD.') from exc


@router.post('/income', response_model=RecordIncomeResponse)
async def record_income(
    body: RecordIncomeRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RecordIncomeResponse:
    result = await ledger.put__record_income(
        user_id=user.user_id,
        bank_account_id=body.bank_account_id,
        income_source_id=body.income_source_id,
        amount=body.amount,
        currency_code=body.currency_code,
        budget_amount_in_base=body.budget_amount_in_base,
        comment=body.comment,
        operated_at=body.operated_at,
    )
    return RecordIncomeResponse(**result)


class RecordIncomeSplitRequest(BaseModel):
    income_source_id: int
    amount: float
    currency_code: str
    budget_amount_in_base: Optional[float] = None
    comment: Optional[str] = None
    operated_at: Optional[date] = None

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return v


class RecordIncomeSplitResponse(BaseModel):
    operation_ids: List[int]
    total_budget_in_base: float
    base_currency_code: str


@router.post('/income-split', response_model=RecordIncomeSplitResponse)
async def record_income_split(
    body: RecordIncomeSplitRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RecordIncomeSplitResponse:
    result = await ledger.put__record_income_split(
        user_id=user.user_id,
        income_source_id=body.income_source_id,
        amount=body.amount,
        currency_code=body.currency_code,
        budget_amount_in_base=body.budget_amount_in_base,
        operated_at=body.operated_at,
        comment=body.comment,
    )
    return RecordIncomeSplitResponse(**result)


@router.post('/expense', response_model=RecordExpenseResponse)
async def record_expense(
    body: RecordExpenseRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> RecordExpenseResponse:
    result = await ledger.put__record_expense(
        user_id=user.user_id,
        bank_account_id=body.bank_account_id,
        category_id=body.category_id,
        amount=body.amount,
        currency_code=body.currency_code,
        comment=body.comment,
        operated_at=body.operated_at,
    )
    return RecordExpenseResponse(**result)


@router.post('/exchange', response_model=ExchangeCurrencyResponse)
async def exchange_currency(
    body: ExchangeCurrencyRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> ExchangeCurrencyResponse:
    result = await ledger.put__exchange_currency(
        user_id=user.user_id,
        bank_account_id=body.bank_account_id,
        from_currency_code=body.from_currency_code,
        from_amount=body.from_amount,
        to_currency_code=body.to_currency_code,
        to_amount=body.to_amount,
        comment=body.comment,
    )
    return ExchangeCurrencyResponse(**result)


@router.post('/allocate', response_model=AllocateBudgetResponse)
async def allocate_budget(
    body: AllocateBudgetRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> AllocateBudgetResponse:
    operation_id = await ledger.put__allocate_budget(
        user_id=user.user_id,
        from_category_id=body.from_category_id,
        to_category_id=body.to_category_id,
        amount_in_base=body.amount_in_base,
        comment=body.comment,
    )
    return AllocateBudgetResponse(operation_id=operation_id)


@router.post('/allocate-group', response_model=AllocateGroupBudgetResponse)
async def allocate_group_budget(
    body: AllocateGroupBudgetRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> AllocateGroupBudgetResponse:
    result = await ledger.put__allocate_group_budget(
        user_id=user.user_id,
        from_category_id=body.from_category_id,
        group_id=body.group_id,
        amount_in_base=body.amount_in_base,
        comment=body.comment,
    )
    return AllocateGroupBudgetResponse(**result)


@router.post('/account-transfer', response_model=AccountTransferResponse)
async def transfer_between_accounts(
    body: AccountTransferRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> AccountTransferResponse:
    result = await ledger.put__transfer_between_accounts(
        user_id=user.user_id,
        from_account_id=body.from_account_id,
        to_account_id=body.to_account_id,
        currency_code=body.currency_code,
        amount=body.amount,
        comment=body.comment,
    )
    return AccountTransferResponse(**result)


@router.post('/reverse', response_model=ReverseOperationResponse)
async def reverse_operation(
    body: ReverseOperationRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> ReverseOperationResponse:
    result = await ledger.put__reverse_operation(
        user_id=user.user_id,
        operation_id=body.operation_id,
        comment=body.comment,
    )
    return ReverseOperationResponse(**result)


@router.get('/history', response_model=OperationHistoryResponse)
async def get_operations_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    operation_type: Optional[str] = Query(None),
    user: TelegramUser = Depends(get_telegram_user),
) -> OperationHistoryResponse:
    result = await reports.get__operations_history(
        user_id=user.user_id,
        limit=limit,
        offset=offset,
        operation_type=operation_type,
    )
    return OperationHistoryResponse(**result)


@router.get('/analytics', response_model=OperationAnalyticsResponse)
async def get_operations_analytics(
    anchor_date: Optional[str] = Query(None, description='Дата внутри периода в формате YYYY-MM-DD'),
    period_mode: Literal['week', 'month', 'year'] = Query('month'),
    operation_type: Literal['expense', 'income'] = Query('expense'),
    owner_scope: Literal['all', 'user', 'family'] = Query('all'),
    periods: int = Query(6, ge=1, le=24),
    user: TelegramUser = Depends(get_telegram_user),
) -> OperationAnalyticsResponse:
    parsed_anchor_date = parse_anchor_date(anchor_date)
    result = await reports.get__operations_analytics(
        user_id=user.user_id,
        anchor_date=parsed_anchor_date,
        period_mode=period_mode,
        operation_type=operation_type,
        owner_scope=owner_scope,
        periods=periods,
    )
    return OperationAnalyticsResponse(**result)
