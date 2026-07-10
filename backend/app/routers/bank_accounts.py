import calendar
from datetime import date, datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import context, reports


router = APIRouter(prefix='/api/v1/bank-accounts', tags=['bank-accounts'])


class BankAccountItem(BaseModel):
    id: int
    name: str
    owner_type: str
    owner_user_id: Optional[int] = None
    owner_family_id: Optional[int] = None
    owner_name: str
    account_kind: Literal['cash', 'investment', 'credit']
    investment_asset_type: Optional[Literal['security', 'deposit', 'crypto', 'other']] = None
    credit_kind: Optional[Literal['loan', 'credit_card', 'mortgage']] = None
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[str] = None
    credit_ends_at: Optional[str] = None
    credit_limit: Optional[float] = None
    monthly_payment: Optional[float] = None
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None
    badge_color: Optional[str] = None
    is_primary: bool
    is_active: bool
    created_at: str


class BankAccountBalanceItem(BaseModel):
    asset_type: str = 'fiat'
    crypto_asset_id: Optional[int] = None
    currency_code: str
    symbol: Optional[str] = None
    amount: float
    historical_cost_in_base: float
    base_currency_code: str
    network_code: Optional[str] = None
    contract_address: Optional[str] = None
    decimals: Optional[int] = None


class CreateBankAccountRequest(BaseModel):
    name: str
    owner_type: Literal['user', 'family'] = 'user'
    account_kind: Literal['cash', 'investment'] = 'investment'
    investment_asset_type: Optional[Literal['security', 'deposit', 'crypto', 'other']] = None
    provider_name: Optional[str] = None
    provider_account_ref: Optional[str] = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()


class CreateCreditAccountRequest(BaseModel):
    name: str
    credit_kind: Literal['loan', 'credit_card', 'mortgage']
    currency_code: str
    credit_limit: float
    target_account_id: Optional[int] = None
    owner_type: Literal['user', 'family'] = 'user'
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[date] = None
    credit_ends_at: Optional[date] = None
    provider_name: Optional[str] = None
    badge_color: Optional[str] = None
    monthly_payment: Optional[float] = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()

    @field_validator('credit_limit')
    @classmethod
    def credit_limit_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Кредитный лимит должен быть положительным')
        return v

    @field_validator('payment_day')
    @classmethod
    def payment_day_must_be_valid(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 31):
            raise ValueError('День платежа должен быть от 1 до 31')
        return v

    @field_validator('interest_rate')
    @classmethod
    def interest_rate_must_not_be_negative(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError('Ставка не может быть отрицательной')
        return v

    @field_validator('monthly_payment')
    @classmethod
    def monthly_payment_must_be_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError('Ежемесячный платёж должен быть положительным')
        return v


class UpdateCreditAccountRequest(BaseModel):
    name: str
    credit_limit: float
    interest_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[date] = None
    credit_ends_at: Optional[date] = None
    provider_name: Optional[str] = None
    badge_color: Optional[str] = None
    monthly_payment: Optional[float] = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Название не может быть пустым')
        return v.strip()

    @field_validator('credit_limit')
    @classmethod
    def credit_limit_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Кредитный лимит должен быть положительным')
        return v

    @field_validator('payment_day')
    @classmethod
    def payment_day_must_be_valid(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 31):
            raise ValueError('День платежа должен быть от 1 до 31')
        return v

    @field_validator('interest_rate')
    @classmethod
    def interest_rate_must_not_be_negative(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError('Ставка не может быть отрицательной')
        return v

    @field_validator('monthly_payment')
    @classmethod
    def monthly_payment_must_be_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError('Ежемесячный платёж должен быть положительным')
        return v


class CreditRepaymentRequest(BaseModel):
    from_account_id: int
    currency_code: str
    amount: float
    comment: Optional[str] = None
    payment_at: Optional[datetime] = None
    payment_kind: Literal['scheduled', 'early'] = 'scheduled'
    recalc_payment: bool = False

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v

    @field_validator('currency_code')
    @classmethod
    def currency_code_must_be_valid(cls, v: str) -> str:
        value = v.strip().upper()
        if len(value) != 3 or not value.isalpha():
            raise ValueError('Код валюты должен состоять из 3 букв')
        return value


class CreditRepaymentResponse(BaseModel):
    operation_id: int
    payment_amount: float
    principal_paid: float
    interest_paid: float
    principal_before: float
    principal_after: float
    accrued_interest: float
    amount_in_base: float
    base_currency_code: str
    payment_kind: Literal['scheduled', 'early'] = 'scheduled'
    monthly_payment: Optional[float] = None


class CreditScheduleItem(BaseModel):
    operation_id: Optional[int] = None
    scheduled_date: str
    total_payment: float
    principal_component: float
    interest_component: float
    principal_before: float
    principal_after: float
    payment_kind: Optional[Literal['scheduled', 'early']] = None
    status: Literal['paid', 'planned'] = 'planned'


class CreditAccountSummaryResponse(BaseModel):
    bank_account_id: int
    name: str
    credit_kind: Literal['loan', 'credit_card', 'mortgage']
    currency_code: str
    principal_outstanding: float
    accrued_interest: float
    total_due_as_of: float
    annual_rate: Optional[float] = None
    payment_day: Optional[int] = None
    credit_started_at: Optional[str] = None
    credit_ends_at: Optional[str] = None
    credit_limit: Optional[float] = None
    monthly_payment: Optional[float] = None
    last_accrual_date: Optional[str] = None
    last_payment_at: Optional[str] = None
    payments_count: int
    paid_principal_total: float
    paid_interest_total: float
    as_of_date: str
    schedule_available: bool
    remaining_payments: int
    next_payment_date: Optional[str] = None
    next_payment_total: Optional[float] = None
    next_payment_principal: Optional[float] = None
    next_payment_interest: Optional[float] = None


class DeleteInvestmentAccountResponse(BaseModel):
    bank_account_id: int
    name: str
    status: Literal['deleted']


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _payment_date_for_month(year: int, month: int, payment_day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(payment_day, last_day))


def _add_months(value: date, amount: int) -> date:
    month_index = value.month - 1 + amount
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return _payment_date_for_month(year, month, value.day)


def _month_key(value: date) -> int:
    return value.year * 12 + value.month


def _next_payment_date(as_of: date, payment_day: int, include_same_day: bool = True) -> date:
    candidate = _payment_date_for_month(as_of.year, as_of.month, payment_day)
    if candidate > as_of or (include_same_day and candidate == as_of):
        return candidate
    next_month_anchor = date(as_of.year, as_of.month, 1)
    next_month_anchor = _add_months(next_month_anchor, 1)
    return _payment_date_for_month(next_month_anchor.year, next_month_anchor.month, payment_day)


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _days_in_year(year: int) -> int:
    return 366 if _is_leap_year(year) else 365


def _actual_actual_interest(principal: float, annual_rate: float, date_from: date, date_to: date) -> float:
    """Calculate interest using actual/actual day count convention, splitting across year boundaries."""
    if annual_rate <= 0 or principal <= 0 or date_from >= date_to:
        return 0.0
    total = 0.0
    current = date_from
    while current < date_to:
        year_end = date(current.year + 1, 1, 1)
        period_end = min(year_end, date_to)
        days = (period_end - current).days
        total += principal * annual_rate / 100.0 * days / _days_in_year(current.year)
        current = period_end
    return round(total, 2)


def _previous_due_date(due_date: date, payment_day: int) -> date:
    base = date(due_date.year, due_date.month, 1)
    prev_base = _add_months(base, -1)
    return _payment_date_for_month(prev_base.year, prev_base.month, payment_day)


def _paid_toward_period(history_items: list[dict], period_start: date, period_end: date) -> float:
    """How much of the current period's due is already covered by payments in
    (period_start, period_end]: scheduled payments count in full; early
    repayments count only their interest part — that interest would otherwise
    be part of the upcoming due payment, while their principal part is a true
    prepayment and does not replace the monthly installment."""
    total = 0.0
    for item in history_items:
        if item.get('status') != 'paid':
            continue
        scheduled_date = _parse_iso_date(item.get('scheduled_date'))
        if scheduled_date is None or not (period_start < scheduled_date <= period_end):
            continue
        if item.get('payment_kind') == 'early':
            total += float(item.get('interest_component') or 0)
        else:
            total += float(item.get('total_payment') or 0)
    return round(total, 2)


def _build_credit_schedule(
    summary: dict,
    limit: Optional[int] = None,
    history_items: Optional[list[dict]] = None,
) -> list[dict]:
    credit_kind = summary.get('credit_kind')
    annual_rate_raw = summary.get('annual_rate')
    annual_rate = float(annual_rate_raw or 0)
    payment_day = summary.get('payment_day')
    as_of_date = _parse_iso_date(summary.get('as_of_date'))
    credit_started_at = _parse_iso_date(summary.get('credit_started_at'))
    credit_ends_at = _parse_iso_date(summary.get('credit_ends_at'))
    last_accrual_date = _parse_iso_date(summary.get('last_accrual_date'))
    principal = round(float(summary.get('principal_outstanding') or 0), 2)
    payments_count = int(summary.get('payments_count') or 0)

    if (
        credit_kind not in ('loan', 'mortgage')
        or annual_rate_raw is None
        or payment_day is None
        or as_of_date is None
        or credit_ends_at is None
        or principal <= 0
    ):
        return []

    include_same_day = not (
        payments_count == 0
        and credit_started_at is not None
        and as_of_date <= credit_started_at
    )
    # Current period: (previous due date, current due date]. The schedule is
    # anchored to due dates only, so the interest/principal split does not
    # drift day to day within a period.
    current_due = _next_payment_date(as_of_date, int(payment_day), include_same_day=include_same_day)
    period_start = _previous_due_date(current_due, int(payment_day))
    end_month_key = _month_key(credit_ends_at)

    monthly_payment_raw = summary.get('monthly_payment')
    if monthly_payment_raw is not None and float(monthly_payment_raw) > 0:
        annuity_payment = round(float(monthly_payment_raw), 2)
    else:
        # Bank-style: spread over full periods before the end date, the end-date
        # payment itself is a corrective tail.
        remaining_payments = max(1, end_month_key - _month_key(current_due))
        monthly_rate = annual_rate / 1200 if annual_rate > 0 else 0
        if monthly_rate > 0:
            annuity_payment = principal * monthly_rate / (1 - (1 + monthly_rate) ** (-remaining_payments))
        else:
            annuity_payment = principal / remaining_payments
        annuity_payment = round(annuity_payment, 2)

    # Scheduled payments (in full) and the interest part of early repayments
    # made in the current period reduce what is still due on the current due date.
    paid_in_period = _paid_toward_period(history_items or [], period_start, current_due)
    first_due_total = round(annuity_payment - paid_in_period, 2)

    start_payment_date = current_due
    if first_due_total <= 0:
        base = date(current_due.year, current_due.month, 1)
        next_base = _add_months(base, 1)
        start_payment_date = _payment_date_for_month(next_base.year, next_base.month, int(payment_day))
        first_due_total = annuity_payment

    payment_dates: list[date] = []
    current_payment_date = start_payment_date
    while _month_key(current_payment_date) <= end_month_key and (limit is None or len(payment_dates) < limit):
        payment_dates.append(current_payment_date)
        base = date(current_payment_date.year, current_payment_date.month, 1)
        next_base = _add_months(base, 1)
        current_payment_date = _payment_date_for_month(next_base.year, next_base.month, int(payment_day))

    if not payment_dates:
        return []

    items: list[dict] = []
    current_principal = principal
    if last_accrual_date is not None and last_accrual_date <= start_payment_date:
        prev_date = last_accrual_date
    else:
        prev_date = as_of_date

    for idx, payment_date in enumerate(payment_dates):
        if current_principal <= 0:
            break

        interest_component = _actual_actual_interest(current_principal, annual_rate, prev_date, payment_date)

        total_payment = first_due_total if idx == 0 else annuity_payment
        if interest_component > total_payment:
            interest_component = round(total_payment, 2)
        principal_component = round(max(0, total_payment - interest_component), 2)

        is_final_payment = _month_key(payment_date) >= end_month_key
        if is_final_payment or principal_component >= current_principal:
            principal_component = round(current_principal, 2)
            total_payment = round(principal_component + interest_component, 2)

        principal_after = round(max(0, current_principal - principal_component), 2)

        items.append({
            'operation_id': None,
            'scheduled_date': payment_date.isoformat(),
            'total_payment': total_payment,
            'principal_component': principal_component,
            'interest_component': interest_component,
            'principal_before': round(current_principal, 2),
            'principal_after': principal_after,
            'status': 'planned',
        })

        current_principal = principal_after
        prev_date = payment_date

    return items


def _merge_credit_schedule(history_items: list[dict], planned_items: list[dict]) -> list[dict]:
    merged = [*history_items, *planned_items]
    merged.sort(key=lambda item: (str(item.get('scheduled_date') or ''), 0 if item.get('status') == 'paid' else 1, int(item.get('operation_id') or 0)))
    return merged


@router.get('', response_model=List[BankAccountItem])
async def get_bank_accounts(
    user: TelegramUser = Depends(get_telegram_user),
    is_active: Optional[bool] = Query(True),
    account_kind: Optional[Literal['cash', 'investment', 'credit']] = Query('cash'),
) -> list:
    return await reports.get__bank_accounts(user.user_id, is_active, account_kind)


@router.post('', response_model=BankAccountItem)
async def create_bank_account(
    body: CreateBankAccountRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> BankAccountItem:
    result = await context.put__create_bank_account(
        user_id=user.user_id,
        name=body.name,
        owner_type=body.owner_type,
        account_kind=body.account_kind,
        investment_asset_type=body.investment_asset_type,
        provider_name=body.provider_name,
        provider_account_ref=body.provider_account_ref,
    )
    return BankAccountItem(**result)


@router.post('/credit', response_model=BankAccountItem)
async def create_credit_account(
    body: CreateCreditAccountRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> BankAccountItem:
    result = await context.put__create_credit_account(
        user_id=user.user_id,
        name=body.name,
        credit_kind=body.credit_kind,
        currency_code=body.currency_code,
        credit_limit=body.credit_limit,
        target_account_id=body.target_account_id,
        owner_type=body.owner_type,
        interest_rate=body.interest_rate,
        payment_day=body.payment_day,
        credit_started_at=body.credit_started_at,
        credit_ends_at=body.credit_ends_at,
        provider_name=body.provider_name,
        badge_color=body.badge_color,
        monthly_payment=body.monthly_payment,
    )
    return BankAccountItem(**result)


@router.post('/credit/{bank_account_id}/archive')
async def archive_credit_account(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> dict:
    return await context.set__archive_credit_account(
        user_id=user.user_id,
        bank_account_id=bank_account_id,
    )


@router.delete('/investment/{bank_account_id}', response_model=DeleteInvestmentAccountResponse)
async def delete_investment_account(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> DeleteInvestmentAccountResponse:
    result = await context.set__delete_investment_account(
        user_id=user.user_id,
        bank_account_id=bank_account_id,
    )
    return DeleteInvestmentAccountResponse(**result)


@router.post('/credit/{bank_account_id}/update', response_model=BankAccountItem)
async def update_credit_account(
    bank_account_id: int,
    body: UpdateCreditAccountRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> BankAccountItem:
    result = await context.set__update_credit_account(
        user_id=user.user_id,
        bank_account_id=bank_account_id,
        name=body.name,
        credit_limit=body.credit_limit,
        interest_rate=body.interest_rate,
        payment_day=body.payment_day,
        credit_started_at=body.credit_started_at,
        credit_ends_at=body.credit_ends_at,
        provider_name=body.provider_name,
        badge_color=body.badge_color,
        monthly_payment=body.monthly_payment,
    )
    return BankAccountItem(**result)


@router.get('/credit/{bank_account_id}/summary', response_model=CreditAccountSummaryResponse)
async def get_credit_account_summary(
    bank_account_id: int,
    as_of: Optional[date] = Query(None),
    user: TelegramUser = Depends(get_telegram_user),
) -> CreditAccountSummaryResponse:
    effective_as_of = as_of or date.today()
    result = await reports.get__credit_account_summary(
        user.user_id,
        bank_account_id,
        effective_as_of,
    )
    if not result:
        raise HTTPException(status_code=404, detail='Кредитный счёт не найден')

    history_items = await reports.get__credit_payment_schedule_events(
        user.user_id,
        bank_account_id,
        effective_as_of,
    )
    schedule_items = _build_credit_schedule(result, history_items=history_items)
    next_payment = schedule_items[0] if schedule_items else None
    result = {
        **result,
        'schedule_available': bool(schedule_items),
        'remaining_payments': len(schedule_items),
        'next_payment_date': next_payment['scheduled_date'] if next_payment else None,
        'next_payment_total': next_payment['total_payment'] if next_payment else None,
        'next_payment_principal': next_payment['principal_component'] if next_payment else None,
        'next_payment_interest': next_payment['interest_component'] if next_payment else None,
    }
    return CreditAccountSummaryResponse(**result)


@router.get('/credit/{bank_account_id}/schedule', response_model=List[CreditScheduleItem])
async def get_credit_account_schedule(
    bank_account_id: int,
    as_of: Optional[date] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=720),
    user: TelegramUser = Depends(get_telegram_user),
) -> list[dict]:
    effective_as_of = as_of or date.today()
    summary = await reports.get__credit_account_summary(
        user.user_id,
        bank_account_id,
        effective_as_of,
    )
    if not summary:
        raise HTTPException(status_code=404, detail='Кредитный счёт не найден')
    history_items = await reports.get__credit_payment_schedule_events(
        user.user_id,
        bank_account_id,
        effective_as_of,
    )
    planned_items = _build_credit_schedule(summary, limit=limit, history_items=history_items)
    return _merge_credit_schedule(history_items, planned_items)


@router.post('/credit/{bank_account_id}/repay', response_model=CreditRepaymentResponse)
async def repay_credit_account(
    bank_account_id: int,
    body: CreditRepaymentRequest,
    user: TelegramUser = Depends(get_telegram_user),
) -> CreditRepaymentResponse:
    result = await context.put__repay_credit_account(
        user_id=user.user_id,
        from_account_id=body.from_account_id,
        credit_account_id=bank_account_id,
        currency_code=body.currency_code,
        amount=body.amount,
        comment=body.comment,
        payment_at=body.payment_at,
        payment_kind=body.payment_kind,
        recalc_payment=body.recalc_payment,
    )
    return CreditRepaymentResponse(**result)


@router.get('/{bank_account_id}/snapshot', response_model=List[BankAccountBalanceItem])
async def get_bank_account_snapshot(
    bank_account_id: int,
    user: TelegramUser = Depends(get_telegram_user),
) -> list:
    return await reports.get__bank_snapshot(user.user_id, bank_account_id)
