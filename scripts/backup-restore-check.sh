#!/usr/bin/env bash
# Restore the newest dump of each backup target into a throwaway postgres:17
# without network and compare per-table row counts with the live database.
# Prints counts only, never row data. Run on the prod host from the project dir:
#   ./scripts/backup-restore-check.sh            # local and remote
#   ./scripts/backup-restore-check.sh remote
# Exit code is non-zero if any dump fails to download or restore, or if the
# restored schema has a different set of tables than the live one.

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
readonly PROJECT_DIR
readonly ENV_FILE="${BACKUP_ENV_FILE:-${PROJECT_DIR}/infra/.env}"
readonly COMPOSE_FILE="${PROJECT_DIR}/infra/docker-compose.yml"

# Same allow-list parsing as backup-to-minio.sh: never execute .env as code.
while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
  [[ -z "${env_line}" || "${env_line}" == \#* || "${env_line}" != *=* ]] && continue
  env_key="${env_line%%=*}"
  env_value="${env_line#*=}"
  env_value="${env_value%$'\r'}"
  case "${env_key}" in
    POSTGRES_USER|DB_DATABASE|\
    MINIO_ENDPOINT|MINIO_BUCKET|MINIO_PREFIX|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|\
    LOCAL_S3_ENDPOINT|LOCAL_S3_BUCKET|LOCAL_S3_PREFIX|LOCAL_S3_ACCESS_KEY|LOCAL_S3_SECRET_KEY)
      printf -v "${env_key}" '%s' "${env_value}"
      ;;
  esac
done < "${ENV_FILE}"
: "${POSTGRES_USER:=postgres}"
: "${DB_DATABASE:=budget_bot}"

WORK_DIR="$(mktemp -d /tmp/budget-bot-restore-check.XXXXXX)"
export MC_CONFIG_DIR="${WORK_DIR}/mc"
readonly CONTAINER="budget-bot-restore-check-$$"
cleanup() {
  docker rm -f -v "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf -- "${WORK_DIR:?}"
}
trap cleanup EXIT

# Row count of every user table, one "schema.table count" line each.
readonly COUNTS_SQL="
SELECT table_schema || '.' || table_name || ' ' ||
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
          false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1;"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${DB_DATABASE}" -AtX -v ON_ERROR_STOP=1 \
  -c "${COUNTS_SQL}" | LC_ALL=C sort > "${WORK_DIR}/live.txt"

failed=0
check_target() {
  local target="$1" endpoint bucket prefix access secret
  if [[ "${target}" == remote ]]; then
    endpoint="${MINIO_ENDPOINT:-}" bucket="${MINIO_BUCKET:-}" prefix="${MINIO_PREFIX:-budget-bot}"
    access="${MINIO_ACCESS_KEY:-}" secret="${MINIO_SECRET_KEY:-}"
  else
    endpoint="${LOCAL_S3_ENDPOINT:-}" bucket="${LOCAL_S3_BUCKET:-}" prefix="${LOCAL_S3_PREFIX:-budget-bot}"
    access="${LOCAL_S3_ACCESS_KEY:-}" secret="${LOCAL_S3_SECRET_KEY:-}"
  fi
  echo "== [${target}]"

  mc alias set "${target}" "${endpoint}" "${access}" "${secret}" >/dev/null
  local newest
  newest="$(mc find "${target}/${bucket}/${prefix}/" --name 'budget_bot_*.dump' --print '{}' \
    | LC_ALL=C sort -r | head -n 1)"
  if [[ -z "${newest}" ]]; then
    echo "FAIL no dumps found"; return 1
  fi
  local dump="${WORK_DIR}/${target}.dump"
  mc cp --quiet "${newest}" "${dump}" >/dev/null
  echo "dump    ${newest##*/} ($(du -h --apparent-size "${dump}" | cut -f1))"

  docker rm -f -v "${CONTAINER}" >/dev/null 2>&1 || true
  docker run -d --name "${CONTAINER}" --network none \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
  # The image first runs a temporary init server on the unix socket only and
  # then restarts; TCP on loopback answers only once the final server is up.
  for _ in $(seq 60); do
    docker exec "${CONTAINER}" pg_isready -h 127.0.0.1 -U postgres -q 2>/dev/null && break
    sleep 1
  done
  docker exec "${CONTAINER}" createdb -U postgres restored
  if ! docker exec -i "${CONTAINER}" pg_restore -U postgres -d restored \
      --exit-on-error --no-owner --no-privileges < "${dump}"; then
    echo "FAIL pg_restore"; return 1
  fi
  docker exec "${CONTAINER}" psql -U postgres -d restored -AtX -v ON_ERROR_STOP=1 \
    -c "${COUNTS_SQL}" | LC_ALL=C sort > "${WORK_DIR}/${target}.txt"

  local rows
  rows="$(awk '{s += $2} END {print s + 0}' "${WORK_DIR}/${target}.txt")"
  echo "restore ok: $(wc -l < "${WORK_DIR}/${target}.txt") tables, ${rows} rows"
  # Tables present on one side only mean a broken or foreign dump.
  if ! diff <(cut -d' ' -f1 "${WORK_DIR}/live.txt") <(cut -d' ' -f1 "${WORK_DIR}/${target}.txt") >/dev/null; then
    echo "FAIL table set differs from live:"
    diff <(cut -d' ' -f1 "${WORK_DIR}/live.txt") <(cut -d' ' -f1 "${WORK_DIR}/${target}.txt") || true
    return 1
  fi
  # Row counts drift by whatever was written since the dump; report, don't fail.
  join "${WORK_DIR}/live.txt" "${WORK_DIR}/${target}.txt" \
    | awk '$2 != $3 {printf "  differs %-45s live %s, dump %s\n", $1, $2, $3; n++}
           END {print "tables with different row count: " n + 0}'
}

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(local remote)
for target in "${targets[@]}"; do
  check_target "${target}" || failed=1
done
exit "${failed}"
