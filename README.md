# Budget Bot

Telegram-бот для ведения личного бюджета. Позволяет создавать категории доходов и расходов, отслеживать транзакции, объединять категории в группы с процентным распределением и просматривать аналитику.

## Web Preview

В проект добавлен первый каркас web-приложения:

- [backend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend) — `FastAPI` API
- [frontend](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend) — `React + Vite + TypeScript`

На текущем шаге это стартовый UI под новую доменную модель:

- общий мультивалютный банк,
- бюджетные категории в базовой валюте,
- список последних операций,
- mock API для первого экрана.

### Быстрый запуск web-версии

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Переменные backend лежат в [backend/.env](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend/.env).
Шаблон для копирования: [backend/.env.example](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend/.env.example)

Основные переменные:

```env
APP_HOST=127.0.0.1
APP_PORT=8000
FRONTEND_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=budget_bot
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DB_SCHEMA=budgeting
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

После запуска frontend открой `http://localhost:8080`.

Сейчас UI получает данные из mock endpoint:

- `GET /health`
- `GET /api/v1/dashboard/overview`

Следующий этап — заменить mock-ответы на реальные вызовы SQL-функций из схемы `budgeting`.

## Технологический стек

- **Python 3.10**
- **aiogram 3.3** — асинхронный фреймворк для Telegram Bot API
- **PostgreSQL 13** — база данных (бизнес-логика реализована через хранимые функции)
- **asyncpg** — асинхронный драйвер для работы с PostgreSQL
- **Docker / Docker Compose** — контейнеризация и оркестрация
- **GitHub Actions** — CI/CD (сборка образа, деплой на сервер по SSH)

## Структура проекта

```
budget_bot/
├── .github/workflows/
│   └── budget_bot_ci_cd.yml      # CI/CD пайплайн
├── bot/
│   ├── config.py                 # Конфигурация (переменные окружения)
│   ├── main.py                   # Точка входа, регистрация роутеров
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── database_tools/           # Слой доступа к данным
│   │   ├── databases.py          # Базовый класс подключения к БД
│   │   ├── users.py              # Операции с пользователями
│   │   ├── categories.py         # Операции с категориями
│   │   └── transactions.py       # Операции с транзакциями
│   ├── filters/
│   │   └── category_name.py      # Кастомный фильтр по имени категории
│   ├── handlers/                 # Обработчики команд бота
│   │   ├── common.py             # /start, навигация по меню, /cancel, /help
│   │   ├── default.py            # Обработчик неизвестных сообщений
│   │   ├── categories/           # Управление категориями
│   │   │   ├── create_category.py
│   │   │   ├── delete_category.py
│   │   │   ├── categories_info.py
│   │   │   ├── union_in_group.py
│   │   │   ├── disband_group.py
│   │   │   └── groups_info.py
│   │   ├── income/               # Пополнение категорий и групп
│   │   │   ├── income_by_category.py
│   │   │   └── income_on_group.py
│   │   ├── transactions/         # Расходы и переводы
│   │   │   ├── create_spend.py
│   │   │   └── between_categories.py
│   │   └── analytics/            # Аналитика
│   │       └── simple_analytics.py
│   └── keyboards/                # Клавиатуры
│       ├── menu.py               # Наборы кнопок для меню
│       └── builder.py            # Билдеры ReplyKeyboardMarkup
└── database_scripts/
    └── Scripts/
        ├── run_func_scripts.sh   # Скрипт инициализации функций БД
        ├── table/                # DDL таблиц
        │   ├── users.sql
        │   ├── categories.sql
        │   ├── category_user.sql
        │   ├── category_groups.sql
        │   └── transactions.sql
        └── functions/            # Хранимые функции PostgreSQL
            ├── create__user.sql
            ├── create__category.sql
            ├── create__transaction.sql
            ├── create__recursive_transaction.sql
            ├── delete__category.sql
            ├── delete__last_transaction.sql
            ├── get__categories.sql
            ├── get__categories_balance_json.sql
            ├── get__last_transaction.sql
            ├── union__category_in_group.sql
            ├── disband_group.sql
            ├── change__balance_between_categories.sql
            └── ...
```

## Схема базы данных

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│    users     │     │  category_user   │     │  categories  │
├──────────────┤     ├──────────────────┤     ├──────────────┤
│ id (PK)      │────>│ user_id (FK)     │     │ id (PK)      │
│ username     │     │ category_id (FK) │<────│ name         │
│ first_name   │     │ is_owner         │     │ is_income    │
│ last_name    │     └──────────────────┘     │ date_from    │
└──────────────┘                              │ date_to      │
                                              │ is_activ     │
                                              │ is_group     │
                                              └──────┬───────┘
                                                     │
┌──────────────────┐     ┌──────────────────────┐    │
│ category_groups  │     │    transactions      │    │
├──────────────────┤     ├──────────────────────┤    │
│ id (PK)          │     │ id (PK)              │    │
│ user_id          │     │ user_id              │    │
│ group_id (FK)    │─────│ category_from (FK)   │────┘
│ category_id (FK) │     │ category_to (FK)     │
│ percent          │     │ date                 │
└──────────────────┘     │ amount               │
                         │ description          │
                         └──────────────────────┘
```

- **users** — пользователи Telegram
- **categories** — категории (доход/расход, обычная/группа)
- **category_user** — связь пользователей с категориями (с флагом владельца)
- **category_groups** — состав групп: какие категории входят в группу и с каким процентом
- **transactions** — все финансовые операции

## Функциональность бота

### Команды

| Команда | Кнопка в меню | Описание |
|---------|---------------|----------|
| `/start` | — | Регистрация / приветствие |
| `/main_menu` | Главное меню | Возврат в главное меню |
| `/cancel` | Отмена | Отмена текущей операции |
| `/help` | — | Справка (заглушка) |
| `/income_by_category` | Пополнить категорию | Доход на конкретную категорию |
| `/income_on_group` | Пополнить группу | Доход на группу (распределяется по процентам) |
| `/spend` | Потратить | Списание расхода с категории |
| `/between_categories` | Между счетами | Перевод между категориями |
| `/balance` | Остаток | Баланс по всем категориям |
| `/last_transaction` | Последняя операция | Просмотр последней транзакции |
| `/delete_last_transaction` | Удалить последнюю операцию | Откат последней транзакции |
| `/create_category` | Создать категорию | Создание новой категории |
| `/delete_category` | Удалить категорию | Удаление категории (с переносом остатка) |
| `/categories_info` | Мои категории | Список категорий пользователя |
| `/group_info` | Мои группы | Информация о группе (состав, проценты) |
| `/union_in_group` | Объединить в группу | Создание группы из категорий |
| `/disband_group` | Распустить группу | Расформирование группы |

### Основные сценарии

1. **Создание категории** — пользователь вводит имя и указывает, является ли категория доходом. Все диалоги реализованы через FSM (Finite State Machine) aiogram.

2. **Пополнение категории** — выбирается источник дохода, целевая категория и сумма. Транзакция записывается в БД.

3. **Пополнение группы** — аналогично, но сумма автоматически распределяется между категориями группы по заданным процентам (через `create__recursive_transaction`).

4. **Расход** — пользователь вводит сумму (с опциональным описанием через пробел, например `150.50 обед`) и выбирает категорию списания.

5. **Перевод между категориями** — выбираются две категории и сумма перевода.

6. **Группы** — позволяют объединять несколько категорий расходов и автоматически распределять поступления по процентам. Сумма процентов всех категорий в группе должна равняться 100%.

## Запуск

### Переменные окружения

Создайте файл `bot/.env`:

```env
BOT_TOKEN=<токен Telegram-бота>
DB_HOST=db
DB_PORT=5432
DB_DATABASE=<имя базы данных>
POSTGRES_USER=<пользователь PostgreSQL>
POSTGRES_PASSWORD=<пароль PostgreSQL>
DB_SCHEMA=budgeting
PGDATA=/var/lib/postgresql/data/pgdata
```

### Docker Compose

```bash
cd bot/
docker-compose up -d
```

После запуска контейнеров необходимо инициализировать хранимые функции:

```bash
docker cp ../db/Scripts/ bot_db_1:/Scripts
docker exec -i bot_db_1 sh -c '/Scripts/run_func_scripts.sh'
```

Также предварительно нужно создать таблицы, используя SQL-скрипты из `database_scripts/Scripts/table/`.

## CI/CD

При каждом пуше в репозиторий GitHub Actions:

1. Собирает Docker-образ бота и пушит его на Docker Hub (`shurakostenko/budget_bot:latest`)
2. Подключается к серверу по SSH
3. Формирует `.env` файл из GitHub Secrets
4. Выполняет `git pull`, пересоздает контейнеры и инициализирует функции БД

## Архитектурные решения

- **Бизнес-логика в БД** — основная логика (создание транзакций, рекурсивное распределение по группам, проверки) реализована через хранимые функции PostgreSQL. Python-код вызывает их через `SELECT schema.function(...)`.
- **FSM для диалогов** — все многошаговые сценарии (создание категории, доход, расход и т.д.) построены на конечных автоматах aiogram с хранением состояния в `MemoryStorage`.
- **Кастомный фильтр `CategoryNameFilter`** — проверяет, что введенное пользователем имя категории существует в БД, и передает `category_id` в обработчик.
- **Polling-режим** — бот опрашивает Telegram API (long polling), а не использует вебхуки.

## Лицензия

MIT License. Copyright (c) 2024 Alexander.
