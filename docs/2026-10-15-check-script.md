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

## Реализация (отчёт)

Файлы: `scripts/check.sh`, `scripts/check_css_hex.py`,
`scripts/css-hex-baseline.txt` (194 пары на момент старта),
`scripts/git-hooks/pre-commit`; правки `AGENTS.md` («Проверки»), `CLAUDE.md`,
`docs/TODO.md`.

Как пользоваться:

```bash
scripts/check.sh            # полный, ~25 с на M-серии (Docker нужен)
scripts/check.sh --fast     # ~8 с
git config core.hooksPath scripts/git-hooks   # включить хук, один раз
```

### Проверка критериев (2026-10-15, worktree на `claude/check-script`)

| # | Что сделано | Результат |
|---|---|---|
| 1 | `scripts/check.sh` на чистой ветке | GREEN, 13 шагов, 18/18 SQL-тестов, API-тест пройден |
| 2 | `import os` в конец `backend/app/config.py` | `--fast` и полный: `FAIL ruff`, код 1 |
| 3 | `frontend/src/__broken.ts` с TS2322 | `FAIL frontend typecheck` |
| 4 | `tests/zz_broken.sql` с `RAISE EXCEPTION` | `FAIL sql tests`, остальные шаги идут дальше, код 1 |
| 5 | `.zz-new { color: #123abc }` в `styles.css` | `FAIL css hex colors`, показана строка; старые 194 — OK. `--self-test` ok |
| 6 | коммит с ошибкой ruff через `-c core.hooksPath=scripts/git-hooks` | коммит отклонён; зелёные коммиты ветки прошли через хук |
| 7 | `SIGTERM` во время прогона | контейнер `budget-check-*` удалён, код 130; после обычных прогонов контейнеров не остаётся |
| 8 | `AGENTS.md` «Проверки» | обновлён |

Временные правки после проверок откатаны (`git status` чистый).

### Что нашли по ходу

- В worktree нет ни `venv/`, ни `frontend/node_modules`. Python берётся из venv
  основного checkout-а, `node_modules` ставится `npm ci` при первом прогоне.
- Локальный venv — Python 3.12, CI и прод — 3.10. Синтаксис новее 3.10
  локальный `py_compile` не поймает — поймает CI.
- psql на хосте 14, сервер в контейнере 17 — для `-f` скриптов работает.
- Проверять готовность Postgres через `docker exec pg_isready` нельзя: init-
  сервер образа слушает только сокет и отвечает «готов» до перезапуска.
  Проверяем по TCP с хоста.
- `biome check src` печатает ~157 warnings — не ошибки, как и в CI.
- В `AGENTS.md` до правки упоминались «откат миграций» и Playwright smoke в
  CI — в workflow их нет; формулировку убрал, Playwright — следующий пункт §00.

### Известные ограничения / осознанные риски

- Хук проверяет рабочую копию, а не только застейдженное: неготовая правка в
  соседнем файле может заблокировать коммит. Обход — `--no-verify` осознанно.
- Хук действует только после `git config core.hooksPath scripts/git-hooks`;
  без него Codex коммитит без проверки. Включает владелец после мержа.
- Hex-проверка — простой парсер на регулярках (без полноценного CSS-разбора).
- Если в baseline пара уже есть и её стало больше, в выводе показывается первое
  место с этой парой, а не обязательно новое.

### Откат

`git revert` коммитов ветки; хук: `git config --unset core.hooksPath`.

## Финальное ревью

2026-10-15, отдельная сессия. Ветка `claude/check-script` @ `c5670e2`, дифф
`main...claude/check-script` (локальный `main` = `1830aad`).

### Прогоны

- `scripts/check.sh --fast` — GREEN (6 шагов), код 0.
- `scripts/check.sh` — GREEN (13 шагов, 18 SQL-тестов, API-тест), код 0.
  Прогон шёл **с враждебным окружением**: `PGHOST=127.0.0.1 PGPORT=5432
  PGDATABASE=budget_bot_db PGUSER=nobody DB_HOST=… DB_PORT=5432
  DB_DATABASE=budget_bot_db`. Скрипт всё перекрыл, работал только с
  `budget-check-*`. Контейнеры `budget_bot_db` и `budget-audit-dev-db-1` не
  трогались, после прогона `budget-check-*` не осталось.

### Критерии приёмки — перепроверка

| # | Как проверено в ревью | Итог |
|---|---|---|
| 1 | полный прогон, см. выше | ✅ |
| 2 | не перепроверял отдельно; ruff ловится в п. 6 | ✅ (по отчёту + п. 6) |
| 3 | `frontend/src/__review_broken.ts` (TS2322), **полный** режим | ✅ `FAIL frontend build`, код 1 |
| 4 | `tests/zz_review_broken.sql` с `RAISE EXCEPTION` (вместе с п. 3) | ✅ `FAIL sql tests`, остальные шаги отработали, код 1 |
| 5 | `#12ab34`, `#ABCDEF80` в `@media`, `url(#fade)`; `--self-test` | ✅ новые пойманы, 194 старых — OK. Ложное срабатывание на `url(#fade)` — п. 6 ниже |
| 6 | коммит `import os` в `config.py` через `-c core.hooksPath=scripts/git-hooks` | ✅ хук: `FAIL ruff`, коммит отклонён, HEAD не сдвинулся |
| 7 | SIGINT группе процессов во время «schema from scratch» и во время «sql tests» | ✅ код 130, контейнер удалён в обоих случаях |
| 8 | `AGENTS.md` «Проверки» | ✅ (но см. п. 4 ниже про «том же порядке») |

Все временные правки откатаны, `git status` чистый.

### Сверка с job `verify` в CI

Команды совпадают: npm ci → build → lint → ruff → unittest (те же 2 модуля) →
py_compile (тот же find) → bash -n → схема (тот же `PGOPTIONS`, те же 3
команды) → SQL-тесты (тот же цикл) → API-тест (те же env, кроме `DB_PORT` =
случайный порт). Отличия перечислены в находках 1, 2, 4, 5.

### Security (изоляция БД)

- Контейнер публикуется только на `127.0.0.1`, порт случайный, `--rm` плюс
  `docker rm -f` по `trap EXIT`. На INT/TERM срабатывает `exit 130`, затем EXIT.
- `PGHOST/PGPORT/PGPASSWORD/POSTGRES_USER/DB_DATABASE` выставляются
  принудительно, `PGSERVICE*/PGDATABASE/PGUSER` снимаются, API-тесту `DB_*`
  передаются явно. `load_dotenv` в `backend/app/config.py` не перекрывает
  переменные окружения (override=False), поэтому `backend/.env` не может
  увести тест на dev-базу.
- Без Docker полный режим падает, фолбэка на dev-базу нет.
- Остаточные мелочи — находки 3 и 5.

### Находки

1. **Вопрос владельцу.** Hex-проверки нет в CI. Её ловят только `check.sh` и
   pre-commit хук, поэтому Codex без хука или коммит с `--no-verify` проходят CI
   с новым hex-цветом. Предлагаю добавить в `verify` шаг
   `python scripts/check_css_hex.py`. Он на stdlib, и CI это не замедлит.
   Это правка CI, поэтому решение за владельцем.
2. **Исправить.** `frontend_deps` пропускает `npm ci`, если `node_modules`
   уже есть. После смены `package-lock.json` (rebase на свежий `main`)
   локальный build/lint идёт на старых зависимостях, а CI ставит с нуля.
   Минимальная правка: запускать `npm ci`, если `package-lock.json` новее
   `node_modules/.package-lock.json`.
3. **Исправить.** В блоке изоляции снять ещё `PGHOSTADDR PGOPTIONS PGSSLMODE`
   (или `unset $(compgen -v PG)` перед export). `PGHOSTADDR` перебивает
   `PGHOST`: psql пойдёт на другой хост, но на наш случайный порт, так что
   до dev-базы не дотянется, хотя и упадёт непонятно. `PGOPTIONS` из окружения
   меняет поведение SQL-тестов по сравнению с CI.
4. **Исправить (текст).** В `AGENTS.md` написано «в том же порядке», а
   `docker compose config` в CI идёт последним (в скрипте — перед БД), и
   hex-шага в CI нет. Либо переставить шаг в скрипте в конец, либо поправить
   формулировку («те же команды; плюс hex-цвета»).
5. **Вопрос владельцу.** Если запускать из основного checkout-а, API-тест
   подтягивает из `backend/.env` не-DB переменные (`CREDENTIALS_ENCRYPTION_KEY`,
   CORS и т.п.), а в CI их нет. Изоляцию БД это не ломает, но тест может
   разойтись с CI. Можно задать в `api_tests` недостающие переменные явно
   пустыми, а можно оставить как есть и записать ограничение.
6. **Исправить (мелочь) или принять.** `HEX` считает цветом `url(#fade)`, это
   подтверждено в ревью. Уже записано в ограничениях. Дешёвая правка —
   `(?<![\w(-])#…` или пропуск совпадений внутри `url(...)`.
7. **Вопрос владельцу (мелочь).** `shell_syntax` исключает `*/node_modules/*`,
   а CI — только `./node_modules/*`, то есть CI проверяет `.sh` внутри
   `frontend/node_modules`. Сейчас таких файлов 0. Правильнее, видимо,
   поправить CI под скрипт.

Блокирующих находок нет. Пп. 2–4 — небольшие правки `scripts/check.sh` и
`AGENTS.md`, после них стоит ещё раз прогнать `scripts/check.sh`.

Не делалось: `/security-review` как скилл. Он смотрит изменения текущей
ветки ревьюера, а не `claude/check-script`, поэтому изоляцию БД проверял
руками (см. выше).

### Исправления автора по ревью

- п. 2: `npm ci` запускается, если `frontend/package-lock.json` новее
  `node_modules/.package-lock.json` (проверено `touch` lock-файла).
- п. 3: перед export снимаются все `PG*` (`unset $(compgen -v PG)`). Полный
  прогон с `PGHOSTADDR=10.255.255.1 PGOPTIONS=… PGSSLMODE=require` — GREEN.
- п. 4: `docker compose config` перенесён в конец, как в CI; в `AGENTS.md` —
  «те же команды и порядок, сверх CI — hex-цвета».
- п. 6: `url(#fade)` больше не считается цветом (lookbehind), случай добавлен
  в `--self-test`; baseline не изменился (194).

Вопросы владельцу (пп. 1, 5, 7) остаются открытыми.
