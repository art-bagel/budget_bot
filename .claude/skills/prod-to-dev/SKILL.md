---
name: prod-to-dev
description: Backup the prod budget_bot database and restore it into the local dev Postgres container. Use when the user asks to refresh dev data from prod, restore the database, or says "обнови базу с прода" / "разверни прод на дев".
---

# Prod → Dev database restore

Dumps the entire prod `budget_bot` database and restores it into the dev
Postgres container (`budget_bot_db`), dropping and recreating the `budgeting`
schema first. The dump itself is the backup — it is kept inside the container
after the restore.

## Steps

1. **Check the dev container is running:**
   ```bash
   docker inspect -f '{{.State.Running}}' budget_bot_db
   ```
   If not running, start the stack: `docker compose -f infra/docker-compose.yml up -d db`
   (or the full stack without `db` argument).

2. **Check credentials exist** — `infra/db/.env.prod` must exist (gitignored,
   holds `PROD_PASSWORD`). If it is missing, ask the user for the prod password;
   never invent one and never commit it.

3. **Run the restore** (takes a while — the dump runs over LAN from 192.168.30.105):
   ```bash
   ./infra/db/restore_from_prod.sh
   ```
   The script reads `PROD_PASSWORD` from `infra/db/.env.prod` automatically.
   Defaults can be overridden via env: `PROD_HOST`, `PROD_DB`, `CONTAINER`,
   `DEV_DB`, `DEV_SCHEMA` — see the script header.

4. **Verify the restore** — sanity-check that data landed:
   ```bash
   docker exec budget_bot_db psql -U postgres -d budget_bot -t -c \
     "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'budgeting';"
   ```
   Expect a non-zero table count. If the backend container is running, also check
   `curl -s http://localhost:8000/health` returns `{"status":"ok",...}`.

5. **Report the dump path** printed by the script (`/tmp/prod_budget_bot_<timestamp>.dump`
   inside the container) — that file is the backup. Old dumps can be listed with
   `docker exec budget_bot_db ls -lh /tmp/` and removed with
   `docker exec budget_bot_db rm <path>` once no longer needed.

## Failure modes

- `ERROR: set PROD_PASSWORD` — `infra/db/.env.prod` is missing; see step 2.
- `container budget_bot_db is not running` — see step 1.
- `pg_dump: error: connection ... failed` — prod host 192.168.30.105 unreachable
  (VPN/LAN issue); report to the user, do not retry blindly.
- The restore drops the `budgeting` schema in dev — any local-only dev data is
  lost by design. Warn the user before running if they mention unsaved dev changes.
