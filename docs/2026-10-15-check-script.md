# 2026-10-15 — `scripts/check.sh` и pre-commit хук

Уровень: **M**. Ветка `claude/check-script`. Первый пункт `docs/TODO.md` §00.

## Цель

Одна команда, которая локально повторяет job `verify` из
`.github/workflows/budget_bot_ci_cd.yml`, одинаковая для Claude Code и Codex.
Правило «готово = `scripts/check.sh` зелёный». Быстрая часть висит на git
pre-commit хуке, чтобы Codex (у него нет PostToolUse-хука) тоже не коммитил
красное.

Не входит: Playwright/axe (следующий пункт бэклога), изменения самого CI,
исправление существующих hex-цветов в CSS.

## Решения

- **БД для полного режима — одноразовый контейнер `postgres:17`** (как в CI:
  та же версия, пользователь/база `budget_ci`), порт случайный на `127.0.0.1`,
  удаляется по `trap` при любом выходе. Dev-база (`budget_bot_db` на :5432) и
  прод не трогаются: скрипт не читает `.env` и не принимает внешний `DB_HOST`.
  Нет Docker — полный режим падает с понятной ошибкой, без фолбэка на dev-базу.
- **Окружение.** Python — `venv/` в корне checkout-а, а в worktree без своего
  `venv/` — venv основного checkout-а (`git rev-parse --git-common-dir`/..).
  Переопределяется `VENV=...`. `frontend/node_modules` нет — `npm ci`.
- **Hex-цвета.** `scripts/check_css_hex.py` (stdlib): ищет `#rgb…#rrggbbaa` в
  объявлениях `frontend/src/styles.css` вне правил, чей селектор целиком —
  `:root`, `[data-theme=…]` или `:root:not([data-theme=…])` (в т.ч. внутри
  `@media (prefers-color-scheme…)`). Baseline `scripts/css-hex-baseline.txt` —
  пары «селектор → цвет» с количеством, без номеров строк (не ломается от
  сдвига строк). Падает только на парах сверх baseline. Если нарушений стало
  меньше — подсказка обновить baseline (`--update-baseline`), не ошибка.
- **Хук.** `scripts/git-hooks/pre-commit` → `scripts/check.sh --fast`.
  Установка: `git config core.hooksPath scripts/git-hooks` (конфиг общий для
  всех worktree, путь относительный — каждый worktree берёт свою копию).
  Обход в крайнем случае — `git commit --no-verify`, только осознанно.

## Режимы и порядок (как в CI)

`--fast` (секунды): ruff → frontend typecheck → frontend lint → hex-цвета →
юнит-тесты бэкенда (`test_fx_rates`, `test_bank_account_response`).

Полный (по умолчанию): `npm ci` при необходимости → frontend build
(включает `tsc -b`) → frontend lint → ruff → юнит-тесты → `py_compile` →
`bash -n` по `*.sh` → hex-цвета → `docker compose config` → схема с нуля →
SQL-тесты → API-тест (`backend.tests.test_auth_api`).

Скрипт идёт до конца, копит упавшие шаги и в конце печатает таблицу
`OK/FAIL` с временем; код выхода 1 при любом падении. Исключение — шаги БД:
если схема не собралась, SQL- и API-тесты пропускаются (помечены SKIP).

## Критерии приёмки

1. `scripts/check.sh` зелёный на чистой ветке (= `main` + эта задача).
2. Намеренная ошибка ruff → красный (`--fast` и полный).
3. Намеренная ошибка tsc → красный.
4. Падающий SQL-тест → красный.
5. Новый hex-цвет вне токенов → красный; существующие — нет.
6. `git commit` с установленным хуком запускает `--fast` и блокируется на ошибке.
7. Dev-контейнер и dev-база не тронуты (тестовый контейнер удаляется после
   прогона, в т.ч. при Ctrl-C/ошибке).
8. `AGENTS.md` «Проверки»: «готово = `scripts/check.sh` зелёный».

## Тесты

Критерии 2–6 проверяются руками по разу (временная правка → прогон → откат),
результат записывается в этот файл. Отдельного автотеста на сам скрипт нет —
сам скрипт и есть тест; hex-проверка самопроверяется через `--self-test`
(критерий 5).

## Затронутые области

`scripts/` (новые файлы), `AGENTS.md`, `CLAUDE.md`, `docs/TODO.md`. Миграций
нет, прод не меняется (push в `main` задеплоит только файлы). Откат —
`git revert` коммитов ветки; хук снимается `git config --unset core.hooksPath`.

## Открытые вопросы владельцу

- В `AGENTS.md` упомянут «откат миграций» и Playwright smoke в CI — в текущем
  workflow их нет. Скрипт повторяет то, что есть в workflow.
