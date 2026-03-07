#!/bin/bash
set -euo pipefail

USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
DIRECTORY="/Scripts/budgeting/tb"
FILES=(
    "currencies.sql"
    "users.sql"
    "income_sources.sql"
    "categories.sql"
    "group_members.sql"
    "bank_accounts.sql"
    "operations.sql"
    "bank_entries.sql"
    "budget_entries.sql"
    "fx_lots.sql"
    "lot_consumptions.sql"
    "fx_rate_snapshots.sql"
)

for file_name in "${FILES[@]}"; do
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -f "$DIRECTORY/$file_name"
done
