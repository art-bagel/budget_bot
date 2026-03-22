#!/bin/bash
set -euo pipefail

USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "/Scripts/budgeting/func" ]; then
    DIRECTORY="/Scripts/budgeting/func"
else
    DIRECTORY="$SCRIPT_DIR/budgeting/func"
fi

PRIORITY_FILES=(
    "get__user_family_id.sql"
    "has__owner_access.sql"
    "get__owner_base_currency.sql"
    "get__bank_account_context.sql"
    "get__category_context.sql"
    "get__owner_system_category_id.sql"
    "put__apply_current_bank_delta.sql"
    "put__apply_current_budget_delta.sql"
    "rebuild_current_balances.sql"
)

is_priority_file() {
    local candidate="$1"
    local item
    for item in "${PRIORITY_FILES[@]}"; do
        if [ "$item" = "$candidate" ]; then
            return 0
        fi
    done
    return 1
}

for file_name in "${PRIORITY_FILES[@]}"; do
    if [ -f "$DIRECTORY/$file_name" ]; then
        psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -f "$DIRECTORY/$file_name"
    fi
done

while IFS= read -r file_path; do
    file_name="$(basename "$file_path")"
    if is_priority_file "$file_name"; then
        continue
    fi
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -f "$DIRECTORY/$file_name"
done < <(find "$DIRECTORY" -maxdepth 1 -type f -name '*.sql' | sort)
