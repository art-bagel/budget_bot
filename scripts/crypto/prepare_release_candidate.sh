#!/bin/bash
# Build and verify a crypto release candidate from a production dump, locally only.
#
#   scripts/crypto/prepare_release_candidate.sh <production.dump> <tag>
#
# Restores the dump twice into the local budget_bot_db container: an untouched
# crypto_prod_<tag> and the working crypto_release_<tag>. Applies the branch
# migrations and SQL functions exactly as the deploy does, replays the accepted
# review journal with full verification, dumps the candidate, restores the dump
# once more and requires an identical content digest. Never connects to production.
set -euo pipefail

DUMP="$1"
TAG="$2"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/outputs/crypto-release-$TAG"
SNAPSHOT="crypto_prod_$TAG"
DB="crypto_release_$TAG"
CHECK="${DB}_restore_check"

case "$TAG" in *[!a-z0-9_]*|"") echo "tag must be [a-z0-9_]" >&2; exit 1 ;; esac
mkdir -p "$OUT"
cd "$ROOT"

local_psql() { docker exec -i budget_bot_db sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=1 -At"; }
env_value() { docker inspect budget_bot_db --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$1=//p"; }

echo "== source dump"
shasum -a 256 "$DUMP" | tee "$OUT/source.sha256"
docker cp "$DUMP" "budget_bot_db:/tmp/$TAG.dump"
for name in "$SNAPSHOT" "$DB"; do
    docker exec budget_bot_db sh -c "createdb -U \"\$POSTGRES_USER\" $name && pg_restore -U \"\$POSTGRES_USER\" -d $name --no-owner --no-privileges --exit-on-error /tmp/$TAG.dump"
done
docker exec budget_bot_db rm "/tmp/$TAG.dump"

echo "== migrations and functions (run_migrations.sh, as in deploy)"
PGPASSWORD="$(env_value POSTGRES_PASSWORD)" docker run --rm -e PGHOST=host.docker.internal -e PGPORT=5432 -e PGPASSWORD \
    -e POSTGRES_USER="$(env_value POSTGRES_USER)" -e DB_DATABASE="$DB" -e PGOPTIONS='-c client_min_messages=warning' \
    -v "$ROOT/infra/db/Scripts:/Scripts:ro" postgres:17 bash /Scripts/run_migrations.sh > "$OUT/migrations.log"
grep run_migrations "$OUT/migrations.log"

echo "== replay and verification"
(cd scripts/crypto && ../../venv/bin/python rehearse_release.py --database "$DB" --snapshot "$SNAPSHOT" --out "$OUT/replay") > "$OUT/replay.log" 2>&1 \
    || { tail -20 "$OUT/replay.log"; exit 1; }
tail -1 "$OUT/replay.log"

echo "== candidate dump and restore check"
docker exec budget_bot_db sh -c "pg_dump -U \"\$POSTGRES_USER\" -d $DB -Fc --no-owner --no-privileges" > "$OUT/candidate.dump"
chmod 600 "$OUT/candidate.dump"
docker cp "$OUT/candidate.dump" "budget_bot_db:/tmp/$TAG-candidate.dump"
docker exec budget_bot_db sh -c "createdb -U \"\$POSTGRES_USER\" $CHECK && pg_restore -U \"\$POSTGRES_USER\" -d $CHECK --no-owner --no-privileges --exit-on-error /tmp/$TAG-candidate.dump && rm /tmp/$TAG-candidate.dump"
local_psql "$DB" < scripts/crypto/release_digest.sql > "$OUT/digest.txt"
local_psql "$CHECK" < scripts/crypto/release_digest.sql > "$OUT/digest-restore-check.txt"
diff "$OUT/digest.txt" "$OUT/digest-restore-check.txt"

cat > "$OUT/manifest.json" <<JSON
{
  "tag": "$TAG",
  "git_sha": "$(git rev-parse HEAD)",
  "source_dump_sha256": "$(cut -d' ' -f1 "$OUT/source.sha256")",
  "snapshot_database": "$SNAPSHOT",
  "candidate_database": "$DB",
  "restore_check_database": "$CHECK",
  "candidate_dump_sha256": "$(shasum -a 256 "$OUT/candidate.dump" | cut -d' ' -f1)",
  "digest_sha256": "$(shasum -a 256 "$OUT/digest.txt" | cut -d' ' -f1)",
  "restore_identical": true
}
JSON
cat "$OUT/manifest.json"
