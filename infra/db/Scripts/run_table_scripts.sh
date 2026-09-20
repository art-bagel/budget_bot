#!/bin/bash
set -euo pipefail

USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# В контейнере каталог примонтирован в /Scripts, вне его (CI, локальная
# проверка) берём файлы рядом со скриптом — как это уже делает
# run_func_scripts.sh.
if [ -d "/Scripts/budgeting/tb" ]; then
    DIRECTORY="/Scripts/budgeting/tb"
else
    DIRECTORY="$SCRIPT_DIR/budgeting/tb"
fi
FILES=(
    "currencies.sql"
    "users.sql"
    "auth_identities.sql"
    "sessions.sql"
    "families.sql"
    "family_members.sql"
    "family_invitations.sql"
    "income_sources.sql"
    "categories.sql"
    "group_members.sql"
    "bank_accounts.sql"
    "operations.sql"
    "bank_entries.sql"
    "budget_entries.sql"
    "current_bank_balances.sql"
    "crypto_assets.sql"
    "current_crypto_balances.sql"
    "crypto_lots.sql"
    "crypto_lot_consumptions.sql"
    "crypto_bank_entries.sql"
    "current_budget_balances.sql"
    "fx_lots.sql"
    "lot_consumptions.sql"
    "fx_rate_snapshots.sql"
    "scheduled_expenses.sql"
    "income_source_patterns.sql"
    "portfolio_positions.sql"
    "portfolio_events.sql"
    "crypto_protocol_positions.sql"
    "credit_payment_events.sql"
    "external_connections.sql"
)

# Порядок здесь значим — таблицы ссылаются друг на друга внешними ключами,
# поэтому список задан руками, а не find-ом. Обратная сторона: файл легко
# добавить в tb/ и забыть вписать сюда. Ровно так и случилось с
# credit_payment_events — таблица просто не создавалась на свежей установке,
# и заметить это было неоткуда. Поэтому сверяем каталог со списком.
missing_from_list=()
for file_path in "$DIRECTORY"/*.sql; do
    file_name="$(basename "$file_path")"
    found=0
    for listed in "${FILES[@]}"; do
        if [ "$listed" = "$file_name" ]; then
            found=1
            break
        fi
    done
    if [ "$found" -eq 0 ]; then
        missing_from_list+=("$file_name")
    fi
done

if [ ${#missing_from_list[@]} -gt 0 ]; then
    echo "run_table_scripts: в $DIRECTORY есть файлы, не вписанные в FILES:" >&2
    for file_name in "${missing_from_list[@]}"; do
        echo "  $file_name" >&2
    done
    echo "run_table_scripts: добавьте их в список с учётом порядка внешних ключей." >&2
    exit 1
fi

for file_name in "${FILES[@]}"; do
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -f "$DIRECTORY/$file_name"
done
