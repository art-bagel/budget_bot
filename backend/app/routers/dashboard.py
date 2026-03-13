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
    has_family: bool
    personal_free_budget_in_base: float
    family_free_budget_in_base: float
    family_unallocated_category_id: int | None
    family_bank_account_id: int | None
    family_bank_balances: List[BankBalanceItem]


@router.get('/overview', response_model=DashboardOverviewResponse)
async def get_dashboard_overview(
    bank_account_id: int = Query(...),
    user: TelegramUser = Depends(get_telegram_user),
) -> DashboardOverviewResponse:
    all_bank_accounts = await reports.get__bank_accounts(user.user_id)
    account_snapshots: dict[int, list[dict]] = {}

    for account in all_bank_accounts:
        account_id = int(account['id'])
        account_snapshots[account_id] = await reports.get__bank_snapshot(user.user_id, account_id)

    bank_balances = account_snapshots.get(bank_account_id, [])
    budget_categories = await reports.get__budget_snapshot(user.user_id, True)

    family_account = next(
        (acc for acc in all_bank_accounts if acc.get('owner_type') == 'family'),
        None,
    )
    family_bank_account_id = int(family_account['id']) if family_account else None
    family_bank_balances = account_snapshots.get(family_bank_account_id, []) if family_bank_account_id else []

    base_currency_code = ''

    if bank_balances:
        base_currency_code = bank_balances[0]['base_currency_code']
    elif budget_categories:
        base_currency_code = budget_categories[0]['currency_code']

    total_bank_historical_in_base = round(
        sum(
            float(item['historical_cost_in_base'])
            for snapshot in account_snapshots.values()
            for item in snapshot
        ),
        2,
    )
    total_budget_in_base = round(
        sum(float(item['balance']) for item in budget_categories),
        2,
    )
    has_family = any(item['owner_type'] == 'family' for item in budget_categories)
    personal_free_budget_in_base = round(
        sum(
            float(item['balance'])
            for item in budget_categories
            if item['kind'] == 'system' and item['owner_type'] == 'user'
        ),
        2,
    )
    family_free_budget_in_base = round(
        sum(
            float(item['balance'])
            for item in budget_categories
            if item['kind'] == 'system' and item['owner_type'] == 'family'
        ),
        2,
    )
    free_budget_in_base = round(personal_free_budget_in_base + family_free_budget_in_base, 2)
    family_unallocated = next(
        (item for item in budget_categories
         if item['kind'] == 'system' and item['owner_type'] == 'family' and item['name'] == 'Unallocated'),
        None,
    )
    family_unallocated_category_id = int(family_unallocated['category_id']) if family_unallocated else None
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
        has_family=has_family,
        personal_free_budget_in_base=personal_free_budget_in_base,
        family_free_budget_in_base=family_free_budget_in_base,
        family_unallocated_category_id=family_unallocated_category_id,
        family_bank_account_id=family_bank_account_id,
        family_bank_balances=family_bank_balances,
    )
