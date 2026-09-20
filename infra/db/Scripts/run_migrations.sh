#!/bin/bash
#
# Прогоняет недостающие миграции из budgeting/migrations и пересоздаёт
# SQL-функции. Идемпотентен: повторный запуск ничего не делает.
#
# Зачем: init-скрипты Postgres выполняются только при создании тома, а деплой
# делает лишь `docker compose up -d --build`. До появления этого скрипта новый
# код API уезжал в прод, а функции и миграции БД — нет, пока кто-нибудь не
# накатит их руками. Рассинхронизация кода и схемы жила до следующего ручного
# прогона.
#
# Переменные окружения: POSTGRES_USER, DB_DATABASE.
#   MIGRATIONS_BASELINE=0 — не делать baseline на первом запуске, а честно
#   выполнить все миграции (нужно только для БД, которая реально отстала).
#
# Запуск на боевом хосте:
#   docker compose -f infra/docker-compose.yml exec -T db \
#     sh -lc 'export DB_DATABASE="$POSTGRES_DB"; bash /Scripts/run_migrations.sh'

set -euo pipefail

USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
BASELINE="${MIGRATIONS_BASELINE:-1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "/Scripts/budgeting/migrations" ]; then
    SCRIPTS_ROOT="/Scripts"
else
    SCRIPTS_ROOT="$SCRIPT_DIR"
fi

MIGRATIONS_DIR="$SCRIPTS_ROOT/budgeting/migrations"

psql_q() {
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -tAq -c "$1"
}

# ── Таблица учёта ───────────────────────────────────────────────────────────
# Ключ — имя файла, а не номер: номера в migrations/ дублируются (два 019 и
# два 020), и по номеру их не различить. Порядок — лексикографический по
# имени файла, поэтому дубли применяются детерминированно.
already_tracked="$(psql_q "SELECT to_regclass('budgeting.schema_migrations') IS NOT NULL")"

psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -q <<'SQL'
CREATE TABLE IF NOT EXISTS budgeting.schema_migrations (
    filename    text        NOT NULL PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT current_timestamp,
    -- baseline: запись сделана без выполнения файла, потому что схема уже
    -- содержала эти изменения на момент появления учёта.
    baseline    boolean     NOT NULL DEFAULT false
);
SQL

# Не mapfile: он появился в bash 4, а в macOS до сих пор bash 3.2, и на
# локальной проверке скрипт падал бы ещё до первого запроса.
migration_files=()
while IFS= read -r file_name; do
    migration_files+=("$file_name")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort)

if [ ${#migration_files[@]} -eq 0 ]; then
    echo "run_migrations: в $MIGRATIONS_DIR нет .sql — нечего применять"
    exit 0
fi

# ── Baseline ────────────────────────────────────────────────────────────────
# Первый запуск на существующей БД. Прод накатывали руками и он актуален, а
# свежая установка получает финальную схему из tb/ — в обоих случаях файлы
# уже "применены". Выполнять их повторно нельзя: часть миграций делает INSERT
# (например 022 — backfill бюджетных проводок), и второй прогон удвоил бы
# данные.
if [ "$already_tracked" != "t" ]; then
    if [ "$BASELINE" = "1" ]; then
        echo "run_migrations: учёт миграций создан впервые."
        echo "run_migrations: ${#migration_files[@]} файл(ов) помечаются как применённые БЕЗ выполнения (baseline)."
        echo "run_migrations: если эта БД на самом деле отстала — перезапустите с MIGRATIONS_BASELINE=0."

        for file_name in "${migration_files[@]}"; do
            psql_q "INSERT INTO budgeting.schema_migrations (filename, baseline)
                    VALUES ('${file_name//\'/\'\'}', true)
                    ON CONFLICT (filename) DO NOTHING" > /dev/null
            echo "  baseline  $file_name"
        done
    else
        echo "run_migrations: MIGRATIONS_BASELINE=0 — все миграции будут выполнены."
    fi
fi

# ── Применение недостающих ──────────────────────────────────────────────────
applied_count=0

for file_name in "${migration_files[@]}"; do
    is_applied="$(psql_q "SELECT EXISTS (
        SELECT 1 FROM budgeting.schema_migrations
        WHERE filename = '${file_name//\'/\'\'}'
    )")"

    if [ "$is_applied" = "t" ]; then
        continue
    fi

    echo "run_migrations: применяю $file_name"

    # Всё в одной транзакции (-1): сам файл, отметка о применении и
    # advisory-блокировка. Поэтому невозможны ни "применилось, но не
    # записалось" при обрыве, ни двойное применение двумя параллельными
    # прогонами — второй упрётся в PK по filename и откатится целиком.
    psql -v ON_ERROR_STOP=1 -U "$USERNAME" -d "$DATABASE" -q -1 \
        -c "SELECT pg_advisory_xact_lock(hashtext('budgeting.schema_migrations'))" \
        -f "$MIGRATIONS_DIR/$file_name" \
        -c "INSERT INTO budgeting.schema_migrations (filename) VALUES ('${file_name//\'/\'\'}')"

    applied_count=$((applied_count + 1))
done

if [ "$applied_count" -eq 0 ]; then
    echo "run_migrations: новых миграций нет"
else
    echo "run_migrations: применено миграций: $applied_count"
fi

# ── Функции ─────────────────────────────────────────────────────────────────
# Все 130+ файлов в func/ начинаются с DROP FUNCTION IF EXISTS, поэтому
# пересоздаются на каждом деплое без учёта — это и есть их "миграция".
echo "run_migrations: пересоздаю SQL-функции"
bash "$SCRIPTS_ROOT/run_func_scripts.sh"

echo "run_migrations: готово"
