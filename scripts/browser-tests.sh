#!/bin/bash
#
# Browser tests (Playwright) on a synthetic seed. Used by scripts/check.sh and CI.
#
#   PGHOST/PGPORT/PGPASSWORD/POSTGRES_USER — throwaway Postgres (check.sh
#   container or the CI service). The script recreates budget_test_ui in it.
#   PY — python with backend deps (default: python).
#   Extra args go to `playwright test` (e.g. --update-snapshots).
#
# uvicorn and vite run on the host (127.0.0.1); the Playwright runner runs in
# the official docker image, so screenshots are identical locally and in CI.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PY:-python}"
DB=budget_test_ui
API_PORT=18000
WEB_PORT=15173

PGOPTIONS='-c client_min_messages=warning' psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
PGOPTIONS='-c client_min_messages=warning' DB_DATABASE=$DB bash -c '
    set -e
    psql -q -U "$POSTGRES_USER" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA budgeting"
    bash infra/db/Scripts/run_table_scripts.sh > /dev/null
    bash infra/db/Scripts/run_migrations.sh > /dev/null
'

# Test-only values; nothing is read from infra/.env.dev. Variables absent in
# CI are set empty so backend/.env (load_dotenv does not override) cannot leak in.
export APP_ENV=development APP_HOST=127.0.0.1 APP_PORT=$API_PORT \
    DB_HOST=127.0.0.1 DB_PORT="$PGPORT" DB_DATABASE=$DB DB_SCHEMA=budgeting \
    POSTGRES_PASSWORD="$PGPASSWORD" \
    TELEGRAM_BOT_TOKEN=ui-test-bot-token SIGNUP_INVITE_CODE=ui-test-invite-code \
    FRONTEND_ORIGINS= CREDENTIALS_ENCRYPTION_KEY=

"$PY" scripts/seed_ui_test.py

PIDS=()
cleanup() { [ ${#PIDS[@]} -gt 0 ] && kill "${PIDS[@]}" 2> /dev/null; true; }
trap cleanup EXIT

# Not test-results/: playwright wipes it on start.
LOGS="$ROOT/frontend/browser-logs"
mkdir -p "$LOGS"
# Offline: outbound HTTP (CBR, Bybit, tonapi, CoinGecko) goes to a dead proxy
# and fails at once, so the screens never depend on the internet or live prices.
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost \
    "$PY" -m uvicorn backend.app.main:app --host 127.0.0.1 --port $API_PORT > "$LOGS/api.log" 2>&1 &
PIDS+=($!)
# Production bundle via `vite preview`, not the dev server: a few files instead
# of hundreds of modules (Docker Desktop port forwarding stalls on those), and
# the test covers what actually ships.
(cd frontend && npx vite build --logLevel warn && VITE_API_TARGET=http://127.0.0.1:$API_PORT \
    exec npx vite preview --host 127.0.0.1 --port $WEB_PORT --strictPort) > "$LOGS/web.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 120); do
    curl -fs "http://127.0.0.1:$WEB_PORT/health" > /dev/null && break
    sleep 1
done
curl -fs "http://127.0.0.1:$WEB_PORT/health" > /dev/null || {
    echo "browser-tests: servers did not start, see $LOGS/api.log, $LOGS/web.log" >&2
    exit 1
}

VERSION="$(node -p "require('./frontend/node_modules/@playwright/test/package.json').version")"
if [ "$(uname)" = Linux ]; then
    NET=(--network host)
    HOST=127.0.0.1
else
    # Docker Desktop forwards host.docker.internal to the host loopback.
    NET=()
    HOST=host.docker.internal
fi

docker run --rm --ipc=host ${NET[@]+"${NET[@]}"} \
    --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
    -e PLAYWRIGHT_BASE_URL="http://$HOST:$WEB_PORT" -e PLAYWRIGHT_API_URL="http://$HOST:$API_PORT" \
    -v "$ROOT/frontend:/work" -w /work \
    "mcr.microsoft.com/playwright:v$VERSION-noble" \
    npm run --silent test:browser -- "$@"
