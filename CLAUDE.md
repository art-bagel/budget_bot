# Project Instructions

- When creating a new file that should be tracked by git, run `git add <file>` after creating it.
- When creating a new file that should NOT be tracked (generated files, secrets, caches, IDE configs, node_modules, etc.), add it to `.gitignore` instead of staging it.

## Project documentation

Read the relevant doc before working in its area:

- `BUSINESS_LOGIC.md` — domain model and the four application layers; read before changing business rules in `backend/` or `storage/`.
- `DATA_MODEL.dbml` — current PostgreSQL schema (ledger, personal/family owners, FX lots); read before touching tables or SQL functions in `infra/db/`.
- `DEVELOPMENT_GUIDELINES.md` — coding rules and patterns learned from past bugs; read before any non-trivial change.
- `FRONTEND_CHECKLIST.md` — backend features not yet implemented in the frontend; check before adding frontend features.
- `docs/` — feature plans and integration notes (Tinkoff, crypto/TON, Telegram WebApp safe areas, etc.).

## Verification

- Frontend: `npm run typecheck` and `npm run lint` in `frontend/` (a PostToolUse hook also runs these on edited files).
- Backend: `./venv/bin/ruff check backend storage`.
- Dev servers for browser preview are defined in `.claude/launch.json` (`frontend` on :5173, `backend` on :8000, `concepts` on :4173). The docker stack usually occupies :8000/:8080.
