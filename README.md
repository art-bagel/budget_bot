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

- [BUSINESS_LOGIC.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/BUSINESS_LOGIC.md) — доменные правила и ограничения.
- [DATA_MODEL.dbml](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/DATA_MODEL.dbml) — схема данных в DBML.
- [docs/tinkoff-integration.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/docs/tinkoff-integration.md) — текущее устройство интеграции с T-Bank.
- [docs/investment-implementation-checklist.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/docs/investment-implementation-checklist.md) — текущий статус investment-модуля и backlog.
- [docs/telegram-webapp-safe-area.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/docs/telegram-webapp-safe-area.md) — особенности safe area в Telegram WebApp.

## Структура репозитория

- [backend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend) — FastAPI приложение и HTTP-роутеры.
- [frontend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend) — клиент на React + Vite.
- [storage](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage) — async-обертки над PostgreSQL-функциями и orchestration.
- [infra](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra) — Docker Compose и инфраструктурные файлы.
- [infra/db/Scripts/budgeting/tb](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/tb) — базовые таблицы fresh install.
- [infra/db/Scripts/budgeting/func](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/func) — SQL-функции read/write слоя.
- [infra/db/Scripts/budgeting/migrations](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations) — точечные миграции для уже существующих БД.

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

### Fresh install

При первом старте контейнера применяются:

- таблицы через [infra/db/Scripts/run_table_scripts.sh](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/run_table_scripts.sh)
- SQL-функции через [infra/db/Scripts/run_func_scripts.sh](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/run_func_scripts.sh)

Это вызывается из [infra/db/init/01-init-budgeting.sh](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/init/01-init-budgeting.sh).

### Existing database

Для уже существующей БД изменения нужно применять в два шага:

1. точечные SQL-миграции из [infra/db/Scripts/budgeting/migrations](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations)
2. затем актуальный набор SQL-функций через `run_func_scripts.sh`

Пример для локального Docker-окружения:

```bash
cd infra
docker exec budget_bot_db sh -lc 'export DB_DATABASE="$POSTGRES_DB"; bash /Scripts/run_func_scripts.sh'
```

Важно: каталог `migrations/` сейчас не прогоняется автоматически при fresh init контейнера.

## Пересборка БД

Если нужно полностью пересобрать локальную БД с нуля:

```bash
cd infra
docker compose down -v
docker compose up -d --build
```

После пересборки пользователей и dev-данные нужно создать заново.
