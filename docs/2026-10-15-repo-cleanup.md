# Очистка репозитория перед общими правилами для агентов

## Цель

Всё актуальное уже в проде (`origin/main` 74fe468). Ветки, worktree и рабочие
материалы прошлых задач устарели. Нужно было оставить чистый `main`, вынести
личные данные из репозитория в один архив и сохранить незакоммиченный аудит
Codex для разбора позже.

## Что сделано

1. Незакоммиченный аудит Codex от 2026-10-11 (198 изменений) закоммичен как
   `654f613` в ветку `codex/audit-remediation-20261011`. Ветка только локальная,
   не проверена и не для мержа как есть.
2. Локальный `main` перемотан (fast-forward) на `aa50cb8`: отчёт о деплое
   комиссии крипто-дохода. Это на 1 коммит впереди `origin/main`. Не запушено:
   push в `main` = деплой.
3. Создан архив `../budget_bot_archive/` (права 700, 6,5 ГБ). Состав описан в его
   `README.md`. Перенесены `crypto-task/`, `local-data/`, `outputs/`,
   `archives/`, `infra/db/Scripts/budgeting/manual/`, а также `outputs`
   worktree crypto-accounting и `crypto-task/outputs` из worktree Codex
   (уникальные данные, которых не было в основной копии).
4. Удалены по решению владельца: `outputs/prod-dumps/` и `pre-migrate-dumps/`.
5. Удалены worktree: `.worktrees/{collections,collections-design,crypto-accounting,crypto-design}`,
   `~/.codex/worktrees/5fca/budget_bot`, два мёртвых в `/tmp`.
6. Удалены 16 локальных веток и 6 веток на GitHub (`Multicurrency`,
   `codex/crypto-accounting-recovery`, `fix_bag_ipoteca`, `new_analytics`,
   `refactoring_frontend`, `refrctoring_crypto`). Остались `main` и ветка аудита.
7. Удалены кэши сборки: `ios/DerivedData`, `frontend/dist`, `test-results`,
   `__pycache__`, `.ruff_cache`.
8. В `.gitignore` добавлено `.env.*` (кроме `.env.example`): `infra/.env.dev` был
   не игнорирован.

Проверка после очистки: `ruff check backend storage`, `npm run typecheck` и
`npm run lint` проходят.

## Найдено в процессе

- Неслитые коммиты в удалённых ветках: `check_bag` (3 дизайн-концепта, июль),
  `new_analytics` (4 коммита «feat: crypto», май). `crypto` и
  `codex/crypto-accounting` были влиты в main в переписанном виде. Всё признано
  устаревшим.
- `scripts/crypto/*` (54 файла) ссылаются на `crypto-task/` и `outputs/` в корне
  репозитория. После переноса они без архива не запускаются. Это одноразовые
  скрипты выпуска криптоучёта (выпуск 2026-09-29).
- В архиве остаются ~1,3 ГБ промежуточных dev/prod-дампов внутри
  `outputs-crypto-accounting-worktree/` и `local-data/collections/`.

## Откат

- Удалённые ветки восстанавливаются из reflog (~90 дней), например:
  `git branch check_bag 7fce36c`. Хеши: Multicurrency b00b3e5, auth-rollout
  e486af5, check_bag 7fce36c, codex/crypto-accounting 90b3d87,
  codex/crypto-accounting-recovery 4e00c1a, codex/crypto-design 45b4908,
  codex/currency-reserve ef951f9, crypto 7b2663b, dev-no-implicit-telegram
  eb76be2, feat/collections afd43ae, feat/collections-design 51035e1,
  feat/two-tier-backup 8021721, new_analytics bc700bc, old_main 31bdb31,
  old_main2 922916b. Ветку на GitHub вернуть так: `git push origin <hash>:refs/heads/<name>`.
  Удалённые на GitHub `fix_bag_ipoteca`, `refactoring_frontend` и
  `refrctoring_crypto` полностью содержатся в main.
- Данные: `mv ../budget_bot_archive/<dir> ./`.

## Известные уязвимости / осознанные риски

- В `.claude/settings.local.json` (не в git) в правиле разрешения открытым
  текстом лежит пароль прод-пользователя `readonly_chat_user`. Агент не смог
  убрать его сам: правка собственных разрешений заблокирована. Нужно, чтобы
  владелец удалил строку и сменил пароль.
- Там же `Bash(git:*)` разрешает агенту `git push` без вопроса, а push в `main`
  деплоит в прод.

## Дополнение: crypto-скрипты

`scripts/crypto/` (77 файлов) и ручной прогон `backend/tests/test_crypto_compiled_main_api.py`
скопированы в `../budget_bot_archive/scripts-crypto/` и удалены из репозитория. В CI они не участвовали.
JSON-результаты в `infra/db/Scripts/budgeting/tests/crypto_accounting/` оставлены: в них
пути скриптов записаны только как строки с хешами.

## Открытые вопросы

- Нужны ли промежуточные дампы в архиве (~1,3 ГБ).
- Откатные копии прода после выпуска криптоучёта (`budget_pre_crypto_*`, теги
  `pre-crypto-20260929`) всё ещё на хосте (см. `2026-09-29-crypto-production-release.md`).

## Деплой

2026-10-15 11:42 UTC: `main` `74fe468..d67ffd1` запушен с аппрувом владельца.
GitHub Actions run 38729277239: Verify Project — success, Deploy To Server —
success (11:45:59 UTC). `https://budget.mrbagel.ru/health` → 200, `status: ok`.
