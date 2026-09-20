# Budget Bot

Telegram-бот для учета бюджета и инвестиций с FastAPI backend, PostgreSQL как source of truth бизнес-логики и React/Vite frontend.

## Что в проекте сейчас

Сейчас проект покрывает:

- личный и семейный owner-scope;
- личные, семейные, кредитные и инвестиционные счета;
- бюджетные категории и ledger по обычным расходам/доходам;
- мультивалютный банк с `fx_lots` и FIFO-списанием;
- инвестиционный модуль с `portfolio_positions` и `portfolio_events`;
- ручное и импортированное ведение портфеля;
- интеграцию с T-Bank / Тинькофф Инвестиции;
- read-side проекции для быстрых экранов.

## Основные документы

- [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) — доменные правила и ограничения.
- [DATA_MODEL.dbml](DATA_MODEL.dbml) — схема данных в DBML.
- [docs/tinkoff-integration.md](docs/tinkoff-integration.md) — текущее устройство интеграции с T-Bank.
- [docs/investment-implementation-checklist.md](docs/investment-implementation-checklist.md) — текущий статус investment-модуля и backlog.
- [docs/crypto-investment-accounts.md](docs/crypto-investment-accounts.md) — дизайн-концепт будущих крипто-счетов и DeFi-операций.
- [docs/crypto-account-assets-defi-plan.md](docs/crypto-account-assets-defi-plan.md) — implementation plan модели `crypto account -> assets -> DeFi`.
- [docs/telegram-webapp-safe-area.md](docs/telegram-webapp-safe-area.md) — особенности safe area в Telegram WebApp.
- [docs/ISSUES.md](docs/ISSUES.md) — актуальный анализ багов и уязвимостей, ранжированный по важности.
- [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) — предложения по улучшениям вне багфиксов (БД, бэкенд, фронтенд, UX/UI, продукт).
- [docs/TODO.md](docs/TODO.md) — сводный чеклист всех доработок из ISSUES и IMPROVEMENTS.
- [docs/IDEAS.md](docs/IDEAS.md) — идеи новых функций и развития имеющихся.

## Структура репозитория

- [backend](backend) — FastAPI приложение и HTTP-роутеры.
- [frontend](frontend) — клиент на React + Vite.
- [storage](storage) — async-обертки над PostgreSQL-функциями и orchestration.
- [infra](infra) — Docker Compose и инфраструктурные файлы.
- [infra/db/Scripts/budgeting/tb](infra/db/Scripts/budgeting/tb) — базовые таблицы fresh install.
- [infra/db/Scripts/budgeting/func](infra/db/Scripts/budgeting/func) — SQL-функции read/write слоя.
- [infra/db/Scripts/budgeting/migrations](infra/db/Scripts/budgeting/migrations) — точечные миграции для уже существующих БД.

## Архитектура

Система разделяет несколько слоев:

- реальные деньги в `bank_accounts` и `bank_entries`;
- бюджетные конверты в `categories` и `budget_entries`;
- журнал бизнес-событий в `operations`;
- инвестиционный журнал в `portfolio_positions` и `portfolio_events`;
- read-side проекции в `current_bank_balances` и `current_budget_balances`.

Это позволяет:

- не пересчитывать весь ledger на каждый экран;
- держать бюджет и инвестиции в одной owner-модели;
- отдельно вести cash и investment account flows;
- импортировать T-Bank историю без дублей через `external_id + import_source`.

## Ownership-модель

Поддерживаются два owner-типа:

- `user` — личный контур;
- `family` — общий семейный контур.

Текущие ограничения:

- личные и семейные категории разделены по owner;
- расход из личной категории возможен только с личного счета;
- расход из семейной категории возможен только с семейного счета;
- инвестиционные счета не участвуют в обычных бюджетных категориях напрямую.

## Локальный запуск

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Полный стек

```bash
cd infra
cp .env.example .env
docker compose up --build -d
```

После старта:

- frontend: `http://localhost:8080`
- backend healthcheck: `http://localhost:8000/health`

## Как сейчас живет SQL

Всё применяет один скрипт — [infra/db/Scripts/run_migrations.sh](infra/db/Scripts/run_migrations.sh).
Он идемпотентен: накатывает недостающие миграции и пересоздаёт SQL-функции,
а если менять нечего — не делает ничего.

Учёт ведётся в `budgeting.schema_migrations`. Ключ — имя файла, а не номер:
номера в `migrations/` дублируются (два 019 и два 020). Каждая миграция
применяется одной транзакцией вместе с отметкой о применении, поэтому обрыв
посередине не оставляет базу в состоянии «применилось, но не записалось».

Функции учёта не требуют: все файлы в
[func/](infra/db/Scripts/budgeting/func) начинаются с `DROP FUNCTION IF
EXISTS`, поэтому пересоздаются на каждом прогоне целиком.

### Деплой

Ничего делать руками не нужно. Пайплайн поднимает БД, снимает дамп в
`pre-migrate-dumps/` и прогоняет `run_migrations.sh` — и только после этого
стартует новый API. Порядок важен: иначе свежий код какое-то время ходил бы
в старые функции.

### Fresh install

При создании тома [infra/db/init/01-init-budgeting.sh](infra/db/init/01-init-budgeting.sh)
запускает [run_table_scripts.sh](infra/db/Scripts/run_table_scripts.sh)
(таблицы из [tb/](infra/db/Scripts/budgeting/tb)), а затем `run_migrations.sh`.

На пустой базе учёт заводится в режиме baseline: все файлы помечаются
применёнными **без выполнения**. Так и задумано — `tb/` содержит финальную
схему, и прогонять по ней старые миграции нельзя: часть из них рассчитана на
промежуточное состояние и упадёт (например 012 — на уже существующем
constraint), а 022 это backfill с INSERT, который удвоил бы проводки.

Отсюда следует правило: **новая таблица или колонка добавляется и в
миграцию, и в `tb/`**. Миграция обновляет существующие базы, `tb/` — свежие.
CI собирает схему с нуля на каждый push, так что расхождение всплывёт сразу.
`run_table_scripts.sh` дополнительно падает, если файл положили в `tb/`, но
забыли вписать в список `FILES` (порядок там значим из-за внешних ключей).

### Локальный прогон

```bash
cd infra
docker compose exec -T db sh -lc 'export DB_DATABASE="$POSTGRES_DB"; bash /Scripts/run_migrations.sh'
```

Если база реально отстала (например восстановлена из старого дампа) и
миграции надо именно выполнить, а не отметить:
`MIGRATIONS_BASELINE=0 bash /Scripts/run_migrations.sh`.

## Пересборка БД

Если нужно полностью пересобрать локальную БД с нуля:

```bash
cd infra
docker compose down -v
docker compose up -d --build
```

После пересборки пользователей и dev-данные нужно создать заново.
