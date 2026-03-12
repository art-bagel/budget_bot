from typing import List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.app.dependencies import TelegramUser, get_telegram_user
from backend.app.storage import reports


router = APIRouter(prefix='/api/v1/dashboard', tags=['dashboard'])


class BankBalanceItem(BaseModel):
    currency_code: str
    amount: float
    historical_cost_in_base: float
    base_currency_code: str


class BudgetBalanceItem(BaseModel):
    category_id: int
    name: str
    kind: str
    owner_type: str
    owner_user_id: int | None = None
    owner_family_id: int | None = None
    balance: float
    currency_code: str


class DashboardOverviewResponse(BaseModel):
    base_currency_code: str
    total_bank_historical_in_base: float
    total_budget_in_base: float
    free_budget_in_base: float
    fx_result_in_base: float
    bank_balances: List[BankBalanceItem]
    budget_categories: List[BudgetBalanceItem]


@router.get('/overview', response_model=DashboardOverviewResponse)
async def get_dashboard_overview(
    bank_account_id: int = Query(...),
    user: TelegramUser = Depends(get_telegram_user),
) -> DashboardOverviewResponse:
    bank_balances = await reports.get__bank_snapshot(user.user_id, bank_account_id)
    budget_categories = await reports.get__budget_snapshot(user.user_id, True)

    base_currency_code = ''

    if bank_balances:
        base_currency_code = bank_balances[0]['base_currency_code']
    elif budget_categories:
        base_currency_code = budget_categories[0]['currency_code']

    total_bank_historical_in_base = round(
        sum(float(item['historical_cost_in_base']) for item in bank_balances),
        2,
    )
    total_budget_in_base = round(
        sum(float(item['balance']) for item in budget_categories),
        2,
    )
    free_budget_in_base = round(
        sum(
            float(item['balance'])
            for item in budget_categories
            if item['kind'] == 'system'
        ),
        2,
    )
    fx_result_in_base = round(
        sum(
            float(item['balance'])
            for item in budget_categories
            if item['kind'] == 'system' and item['name'] == 'FX Result'
        ),
        2,
    )
    visible_budget_categories = [
        item
        for item in budget_categories
        if item['kind'] != 'system'
    ]

    return DashboardOverviewResponse(
        base_currency_code=base_currency_code,
        total_bank_historical_in_base=total_bank_historical_in_base,
        total_budget_in_base=total_budget_in_base,
        free_budget_in_base=free_budget_in_base,
        fx_result_in_base=fx_result_in_base,
        bank_balances=bank_balances,
        budget_categories=visible_budget_categories,
    )
