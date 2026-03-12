# Budget Bot

Telegram-бот для учета бюджета с FastAPI backend, PostgreSQL как источником бизнес-логики и React/Vite frontend.

## Что в проекте сейчас

Текущая модель уже ориентирована на:

- личные и семейные owner-scopes;
- личные и семейные банковские счета;
- личные и семейные бюджетные категории;
- мультивалютный банк с `fx_lots` и FIFO-списанием;
- инкрементальные `current_*` проекции для быстрых дашбордов.

Главное текущее ограничение:

- backend и SQL уже переведены на семейную модель;
- frontend под семейные сценарии еще не доведен до конца и остается `work in progress`.

## Основные документы

- [BUSINESS_LOGIC.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/BUSINESS_LOGIC.md) — актуальные бизнес-правила и ограничения доменной модели.
- [DATA_MODEL.dbml](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/DATA_MODEL.dbml) — актуальная схема данных в DBML.

## Структура репозитория

- [backend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend) — FastAPI приложение и HTTP-роутеры.
- [frontend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend) — клиент на React + Vite.
- [storage](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage) — async-обертки над PostgreSQL функциями.
- [infra](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra) — Docker Compose и инфраструктурные файлы.
- [infra/db/Scripts](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts) — source of truth для таблиц и SQL-функций.

## Архитектура

Система разделяет четыре слоя:

- реальные деньги в `bank_accounts` и `bank_entries`;
- бюджетные конверты в `categories` и `budget_entries`;
- журнал бизнес-событий в `operations`;
- read-side проекции в `current_bank_balances` и `current_budget_balances`.

Это позволяет:

- вести один общий семейный счет;
- разделять личные и семейные категории по ownership;
- учитывать FX-себестоимость по историческим лотам;
- не пересчитывать весь ledger на каждый экран дашборда.

## Ownership-модель

Поддерживаются два owner-типа:

- `user` — личный контур;
- `family` — общий семейный контур.

Текущие MVP-ограничения:

- `personal -> personal` allocation: разрешен;
- `family -> family` allocation: разрешен;
- `personal -> family` allocation: запрещен;
- `family -> personal` allocation: запрещен;
- расход из личной категории возможен только с личного счета;
- расход из семейной категории возможен только с семейного счета.

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

## Пересборка БД

Схема пока не миграционная. Если SQL-модель меняется несовместимо, базу проще пересобрать с нуля:

```bash
cd infra
docker compose down -v
docker compose up -d --build
```

После пересборки пользователей нужно зарегистрировать заново через backend API.
