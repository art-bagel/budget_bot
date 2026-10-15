@AGENTS.md

# Только для Claude Code

- Новый файл, который должен быть в git, сразу добавляйте через `git add <file>`. Сгенерированные файлы, секреты, кэши и конфиги IDE — в `.gitignore`.
- PostToolUse-хук `.claude/hooks/post_edit_check.sh` после каждой правки запускает tsc + biome (frontend) или ruff (backend). Ошибку хука исправляйте сразу.
- Dev-серверы для превью описаны в `.claude/launch.json`: `frontend` на :5173, `frontend-docker` (фронт к docker API на :8001), `backend` на :8000. Docker-стек обычно занимает :8000/:8080.
- Скилл `prod-to-dev` обновляет dev-базу копией прода.
