#!/bin/bash
#
# Локальная копия job `verify` из .github/workflows/budget_bot_ci_cd.yml.
# Готово = этот скрипт зелёный.
#
#   scripts/check.sh          полный прогон (как CI), нужен Docker
#   scripts/check.sh --fast   ruff + typecheck + lint + hex-цвета + юниты (pre-commit)
#
# БД для полного прогона — одноразовый контейнер postgres:17 (как в CI) на
# случайном порту 127.0.0.1, удаляется при выходе. Dev-база и прод не
# трогаются: адрес БД скрипт выставляет сам и снаружи не принимает.
#
# Python берётся из venv/ этого checkout-а, а в worktree без своего venv — из
# venv основного checkout-а. Переопределить: VENV=/path/to/venv.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

MODE=full
case "${1:-}" in
    --fast) MODE=fast ;;
    "") ;;
    *) echo "usage: scripts/check.sh [--fast]" >&2; exit 2 ;;
esac

if [ -z "${VENV:-}" ]; then
    VENV="$ROOT/venv"
    [ -x "$VENV/bin/python" ] || VENV="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/venv"
fi
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
    echo "check: нет venv ($VENV). Создайте: python3 -m venv venv && venv/bin/pip install -r backend/requirements.txt -r requirements-dev.txt" >&2
    exit 1
fi

RESULTS=()
FAILED=0
LAST_OK=0

# step <имя> <команда...>: идёт дальше при падении, итог — в конце.
step() {
    local name="$1" started=$SECONDS
    shift
    echo
    echo "── $name"
    if "$@"; then
        RESULTS+=("OK    $name ($((SECONDS - started))s)")
        LAST_OK=1
    else
        RESULTS+=("FAIL  $name")
        FAILED=1
        LAST_OK=0
    fi
}

skip() {
    RESULTS+=("SKIP  $1")
}

in_frontend() { (cd frontend && "$@"); }

frontend_deps() {
    # Как CI: после смены lock-файла (rebase на свежий main) ставим заново.
    [ frontend/node_modules/.package-lock.json -nt frontend/package-lock.json ] && return 0
    in_frontend npm ci
}

ruff_check() { "$VENV/bin/ruff" check backend storage; }

unit_tests() { "$PY" -m unittest backend.tests.test_fx_rates backend.tests.test_bank_account_response; }

py_compile_all() {
    find backend storage -name '*.py' -not -path '*/.cache/*' -print0 \
        | xargs -0 -r "$PY" -m py_compile
}

shell_syntax() {
    find . -name '*.sh' \
        -not -path './venv/*' -not -path '*/node_modules/*' \
        -not -path './crypto-task/*' -not -path './.git/*' \
        -print0 | xargs -0 -r -n1 bash -n
}

css_hex() { "$PY" scripts/check_css_hex.py; }

compose_config() {
    POSTGRES_PASSWORD=ci-validation-only docker compose -f infra/docker-compose.yml config > /dev/null
}

DB_CONTAINER=""
cleanup() {
    [ -n "$DB_CONTAINER" ] && docker rm -f "$DB_CONTAINER" > /dev/null 2>&1
}
trap cleanup EXIT
trap 'exit 130' INT TERM

start_test_db() {
    if ! docker info > /dev/null 2>&1; then
        echo "check: Docker недоступен — полный прогон без него невозможен (dev-базу не используем)." >&2
        return 1
    fi
    DB_CONTAINER="budget-check-$$"
    docker run -d --rm --name "$DB_CONTAINER" \
        -e POSTGRES_USER=budget_ci -e POSTGRES_PASSWORD=budget_ci -e POSTGRES_DB=budget_ci \
        -p 127.0.0.1::5432 postgres:17 > /dev/null || return 1
    local port
    port="$(docker port "$DB_CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
    [ -n "$port" ] || return 1

    # Только наш контейнер: всё, что могло прийти из окружения (PGHOST на
    # dev-базу, PGSERVICE и т.п.), перекрывается.
    # shellcheck disable=SC2046
    unset $(compgen -v PG)
    export PGHOST=127.0.0.1 PGPORT="$port" PGPASSWORD=budget_ci
    export POSTGRES_USER=budget_ci DB_DATABASE=budget_ci

    # По TCP, не через docker exec: init-сервер образа слушает только сокет,
    # и проверка изнутри контейнера отвечает «готов» до перезапуска.
    for _ in $(seq 1 60); do
        pg_isready -q -h 127.0.0.1 -p "$port" -U budget_ci -d budget_ci && return 0
        sleep 1
    done
    echo "check: тестовая БД не поднялась за 60 с" >&2
    return 1
}

build_schema() {
    PGOPTIONS='-c client_min_messages=warning' bash -c '
        set -e
        psql -U budget_ci -d budget_ci -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS budgeting"
        bash infra/db/Scripts/run_table_scripts.sh
        bash infra/db/Scripts/run_migrations.sh
    '
}

sql_tests() {
    local test_file rc=0
    for test_file in infra/db/Scripts/budgeting/tests/*.sql; do
        echo "── $test_file"
        psql -v ON_ERROR_STOP=1 -q -U budget_ci -d budget_ci -f "$test_file" || rc=1
    done
    return $rc
}

api_tests() {
    APP_ENV=development APP_HOST=127.0.0.1 APP_PORT=8000 \
    DB_HOST=127.0.0.1 DB_PORT="$PGPORT" DB_SCHEMA=budgeting POSTGRES_PASSWORD=budget_ci \
    TELEGRAM_BOT_TOKEN=ci-test-bot-token SIGNUP_INVITE_CODE=ci-test-invite-code \
        "$PY" -m backend.tests.test_auth_api
}

if [ "$MODE" = fast ]; then
    step "frontend deps" frontend_deps
    step "ruff" ruff_check
    step "frontend typecheck" in_frontend npm run --silent typecheck
    step "frontend lint" in_frontend npm run --silent lint
    step "css hex colors" css_hex
    step "backend unit tests" unit_tests
else
    step "frontend deps" frontend_deps
    step "frontend build" in_frontend npm run --silent build
    step "frontend lint" in_frontend npm run --silent lint
    step "ruff" ruff_check
    step "backend unit tests" unit_tests
    step "py_compile" py_compile_all
    step "shell syntax" shell_syntax
    step "css hex colors" css_hex
    step "start test db (postgres:17)" start_test_db
    if [ "$LAST_OK" = 1 ]; then
        step "schema from scratch" build_schema
        if [ "$LAST_OK" = 1 ]; then
            step "sql tests" sql_tests
            step "api tests" api_tests
        else
            skip "sql tests"; skip "api tests"
        fi
    else
        skip "schema from scratch"; skip "sql tests"; skip "api tests"
    fi
    step "docker compose config" compose_config
fi

echo
echo "════ check.sh ($MODE)"
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" -ne 0 ]; then
    echo "════ RED"
    exit 1
fi
echo "════ GREEN"
