#!/bin/bash
set -euo pipefail

USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
DIRECTORY="/Scripts/budgeting/func"
FILES=(
    "put__register_user_context.sql"
    "put__create_category.sql"
    "put__create_income_source.sql"
    "set__replace_group_members.sql"
    "put__record_fx_rate_snapshot.sql"
    "put__record_income.sql"
    "put__allocate_budget.sql"
    "put__allocate_group_budget.sql"
    "put__exchange_currency.sql"
    "put__record_expense.sql"
    "put__reverse_operation.sql"
    "get__currencies.sql"
    "get__categories.sql"
    "get__income_sources.sql"
    "get__group_members.sql"
    "get__bank_snapshot.sql"
    "get__budget_snapshot.sql"
    "get__operations_history.sql"
    "get__portfolio_valuation.sql"
)

for file_name in "${FILES[@]}"; do
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -f "$DIRECTORY/$file_name"
done
