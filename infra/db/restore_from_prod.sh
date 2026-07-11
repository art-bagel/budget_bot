#!/usr/bin/env bash
#
# Dump the whole prod `budget_bot` database and restore it into the running
# dev container, dropping & recreating the `budgeting` schema first.
#
# Everything runs INSIDE the dev postgres container (postgres:17), which has
# the matching client tools and can reach the LAN prod host. No local pg
# tooling required.
#
# Usage:
#   ./infra/db/restore_from_prod.sh                      # reads PROD_PASSWORD from infra/db/.env.prod
#   PROD_PASSWORD='...' ./infra/db/restore_from_prod.sh  # or pass it via the environment
#
# The password lives in infra/db/.env.prod (gitignored) — do NOT hardcode it here.

set -euo pipefail

# Load local prod credentials if present (gitignored).
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env.prod"
if [[ -z "${PROD_PASSWORD:-}" && -f "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
fi

# ---- config (override via env) ------------------------------------------------
PROD_HOST="${PROD_HOST:-192.168.30.105}"
PROD_PORT="${PROD_PORT:-5432}"
PROD_USER="${PROD_USER:-readonly_chat_user}"
PROD_DB="${PROD_DB:-budget_bot}"

CONTAINER="${CONTAINER:-budget_bot_db}"
DEV_USER="${DEV_USER:-postgres}"
DEV_DB="${DEV_DB:-budget_bot}"
DEV_SCHEMA="${DEV_SCHEMA:-budgeting}"

DUMP_PATH="/tmp/prod_${PROD_DB}_$(date +%Y%m%d_%H%M%S).dump"
# -------------------------------------------------------------------------------

if [[ -z "${PROD_PASSWORD:-}" ]]; then
  echo "ERROR: set PROD_PASSWORD in the environment before running." >&2
  echo "  PROD_PASSWORD='...' $0" >&2
  exit 1
fi

echo ">> Checking dev container '${CONTAINER}' is running..."
docker inspect -f '{{.State.Running}}' "${CONTAINER}" | grep -q true \
  || { echo "ERROR: container ${CONTAINER} is not running."; exit 1; }

echo ">> Dumping prod ${PROD_DB} from ${PROD_HOST}:${PROD_PORT} (custom format)..."
docker exec -e PGPASSWORD="${PROD_PASSWORD}" "${CONTAINER}" \
  pg_dump -h "${PROD_HOST}" -p "${PROD_PORT}" -U "${PROD_USER}" -d "${PROD_DB}" \
          -Fc --no-owner --no-privileges -v -f "${DUMP_PATH}"

echo ">> Dump written to ${DUMP_PATH} inside the container."
docker exec "${CONTAINER}" ls -lh "${DUMP_PATH}"

echo ">> Dropping & recreating schema '${DEV_SCHEMA}' in dev DB '${DEV_DB}'..."
docker exec "${CONTAINER}" \
  psql -U "${DEV_USER}" -d "${DEV_DB}" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS ${DEV_SCHEMA} CASCADE; CREATE SCHEMA ${DEV_SCHEMA};"

echo ">> Restoring dump into dev DB '${DEV_DB}'..."
# --clean --if-exists also cleans any public-schema objects the whole-db dump carries.
docker exec "${CONTAINER}" \
  pg_restore -U "${DEV_USER}" -d "${DEV_DB}" \
             --clean --if-exists --no-owner --no-privileges \
             "${DUMP_PATH}"

echo ">> Done. Restored prod ${PROD_DB} into dev container ${CONTAINER}:${DEV_DB}."
echo ">> Dump file kept at ${DUMP_PATH} (inside container). Remove with:"
echo "   docker exec ${CONTAINER} rm ${DUMP_PATH}"
