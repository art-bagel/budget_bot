#!/usr/bin/env bash
# Create a PostgreSQL dump, upload it to MinIO and keep only the newest dumps.
# Usage: ./scripts/backup-to-minio.sh

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly ENV_FILE="${BACKUP_ENV_FILE:-${PROJECT_DIR}/infra/.env}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Environment file is not readable: ${ENV_FILE}" >&2
  exit 1
fi

# Read only variables used by this script; do not execute .env as shell code.
while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
  [[ -z "${env_line}" || "${env_line}" == \#* || "${env_line}" != *=* ]] && continue
  env_key="${env_line%%=*}"
  env_value="${env_line#*=}"
  env_value="${env_value%$'\r'}"

  case "${env_key}" in
    POSTGRES_USER|DB_DATABASE|\
    MINIO_ENDPOINT|MINIO_BUCKET|MINIO_PREFIX|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|BACKUP_RETENTION|\
    LOCAL_S3_ENDPOINT|LOCAL_S3_BUCKET|LOCAL_S3_PREFIX|LOCAL_S3_ACCESS_KEY|LOCAL_S3_SECRET_KEY|LOCAL_BACKUP_RETENTION)
      printf -v "${env_key}" '%s' "${env_value}"
      export "${env_key}"
      ;;
  esac
done < "${ENV_FILE}"

# Два независимых контура с разной частотой и глубиной хранения:
#
#   remote - Selectel, offsite-копия, раз в сутки. Значение по умолчанию,
#            поэтому вызов без аргумента ведёт себя ровно как раньше.
#   local  - наш MinIO, почасово: дёшево хранить и быстро восстанавливаться.
#
# Разделение не косметическое. Локальная копия лежит на том же сервере, что и
# сами сервисы, поэтому от потери сервера спасает именно remote - его частоту
# уменьшать нельзя, сколько бы удобным ни казался локальный контур.
readonly BACKUP_TARGET="${1:-remote}"

case "${BACKUP_TARGET}" in
  remote)
    S3_ENDPOINT="${MINIO_ENDPOINT:-}"
    S3_BUCKET="${MINIO_BUCKET:-}"
    S3_PREFIX="${MINIO_PREFIX:-budget-bot}"
    S3_ACCESS_KEY="${MINIO_ACCESS_KEY:-}"
    S3_SECRET_KEY="${MINIO_SECRET_KEY:-}"
    RETENTION="${BACKUP_RETENTION:-14}"
    ;;
  local)
    S3_ENDPOINT="${LOCAL_S3_ENDPOINT:-}"
    S3_BUCKET="${LOCAL_S3_BUCKET:-}"
    S3_PREFIX="${LOCAL_S3_PREFIX:-budget-bot}"
    S3_ACCESS_KEY="${LOCAL_S3_ACCESS_KEY:-}"
    S3_SECRET_KEY="${LOCAL_S3_SECRET_KEY:-}"
    RETENTION="${LOCAL_BACKUP_RETENTION:-48}"
    ;;
  *)
    echo "Unknown backup target: ${BACKUP_TARGET} (expected 'remote' or 'local')" >&2
    exit 1
    ;;
esac
readonly S3_ENDPOINT S3_BUCKET S3_PREFIX S3_ACCESS_KEY S3_SECRET_KEY RETENTION

: "${POSTGRES_USER:=postgres}"
: "${DB_DATABASE:=budget_bot}"

# Бакет и адрес не имеют значений по умолчанию намеренно: молча уехать не в то
# хранилище хуже, чем не запуститься.
if [[ -z "${S3_ENDPOINT}" || -z "${S3_BUCKET}" ]]; then
  echo "Endpoint and bucket for target '${BACKUP_TARGET}' must be set in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${S3_ACCESS_KEY}" || -z "${S3_SECRET_KEY}" ]]; then
  echo "Access and secret key for target '${BACKUP_TARGET}' must be set in ${ENV_FILE}" >&2
  exit 1
fi

if ! [[ "${RETENTION}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Retention for target '${BACKUP_TARGET}' must be a positive integer" >&2
  exit 1
fi

for command_name in docker mc; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is not installed: ${command_name}" >&2
    exit 1
  fi
done

# Блокировка своя на каждый контур: расписания пересекаются (почасовой
# локальный и суточный remote совпадают раз в сутки), и общий замок
# превращал бы это в регулярно пропущенный бэкап.
readonly LOCK_DIR="/tmp/budget-bot-db-backup.${BACKUP_TARGET}.lock"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "Another database backup is already running" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d /tmp/budget-bot-backup.XXXXXX)"
MC_CONFIG_DIR="$(mktemp -d /tmp/budget-bot-mc.XXXXXX)"
cleanup() {
  rm -rf -- "${WORK_DIR:?}" "${MC_CONFIG_DIR:?}"
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

export MC_CONFIG_DIR
readonly TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly BACKUP_NAME="budget_bot_${TIMESTAMP}.dump"
readonly BACKUP_FILE="${WORK_DIR}/${BACKUP_NAME}"
readonly COMPOSE_FILE="${PROJECT_DIR}/infra/docker-compose.yml"
compose_args=(--env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

echo "Creating PostgreSQL dump ${BACKUP_NAME}..."
docker compose "${compose_args[@]}" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${DB_DATABASE}" \
  --format=custom --compress=9 --no-owner --no-privileges > "${BACKUP_FILE}"

echo "Checking dump integrity..."
docker compose "${compose_args[@]}" exec -T db pg_restore --list \
  < "${BACKUP_FILE}" >/dev/null

mc alias set backup "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}" >/dev/null
readonly REMOTE_DIR="backup/${S3_BUCKET}/${S3_PREFIX}"

echo "[${BACKUP_TARGET}] Uploading to ${S3_ENDPOINT}/${S3_BUCKET}/${S3_PREFIX}/${BACKUP_NAME}..."
mc cp "${BACKUP_FILE}" "${REMOTE_DIR}/${BACKUP_NAME}"
mc stat "${REMOTE_DIR}/${BACKUP_NAME}" >/dev/null

echo "[${BACKUP_TARGET}] Removing dumps older than the newest ${RETENTION}..."
mc find "${REMOTE_DIR}" --name 'budget_bot_*.dump' --print '{}' \
  | LC_ALL=C sort -r \
  | sed -n "$((RETENTION + 1)),\$p" \
  | while IFS= read -r old_backup; do
      [[ -n "${old_backup}" ]] && mc rm "${old_backup}"
    done

echo "[${BACKUP_TARGET}] Backup completed successfully: ${BACKUP_NAME}"
