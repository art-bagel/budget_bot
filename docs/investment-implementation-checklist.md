# Investment Implementation Checklist

## Goal

Добавить в проект инвестиционные счета и отдельный раздел портфолио так, чтобы:

- инвестиционные счета были частью банковых счетов;
- бюджет был связан только с личными и семейными cash-счетами;
- перевод из cash в investment уменьшал и счет, и бюджет;
- перевод из investment в cash увеличивал и счет, и бюджет;
- внутри investment-счета можно было вести портфель и позиции;
- модель можно было безболезненно расширять под новые виды инвестиций.

## Product Rules

- У каждого `bank_account` должен быть `account_kind`: `cash` или `investment`.
- `cash`-счета участвуют в бюджете.
- `investment`-счета не участвуют в обычных бюджетных категориях напрямую.
- Перевод `cash -> investment`:
  - уменьшает остаток cash-счета;
  - уменьшает бюджет;
  - увеличивает остаток investment-счета.
- Перевод `investment -> cash`:
  - уменьшает остаток investment-счета;
  - увеличивает остаток cash-счета;
  - увеличивает бюджет.
- Операции внутри investment-счета не меняют обычный бюджет.
- Доход по инвестициям может:
  - оставаться на investment-счете;
  - выводиться на cash-счет с пополнением бюджета.

## Architecture Principles

- Не встраивать инвестиции в `categories` как обычные категории.
- Не делать жесткую схему только под `security`, `deposit`, `crypto`.
- Основные сущности должны быть:
  - инвестиционный счет;
  - позиция;
  - событие по позиции.
- Для расширяемости использовать:
  - `asset_type_code`;
  - `event_type`;
  - `metadata jsonb`.
- В `operations.type` держать небольшое число стабильных типов верхнего уровня.

## Target Domain Model

### 1. Bank Accounts

- [x] Добавить в `bank_accounts` поле `account_kind varchar(20) not null default 'cash'`
- [x] Добавить check constraint `account_kind in ('cash', 'investment')`
- [x] Добавить индекс по `(owner_user_id, account_kind, is_active, id)` для user owner
- [x] Добавить индекс по `(owner_family_id, account_kind, is_active, id)` для family owner
- [ ] Добавить nullable-поля для инвестиционных провайдеров:
  - [x] `provider_name`
  - [x] `provider_account_ref`
- [x] Обновить `get__bank_accounts` так, чтобы возвращался `account_kind`
- [x] Обновить API `/api/v1/bank-accounts`
- [x] Обновить TS-типы фронта

### 2. Asset Type Registry

- [ ] Создать таблицу `investment_asset_types`
- [ ] Поля:
  - [ ] `code`
  - [ ] `name`
  - [ ] `is_active`
  - [ ] `sort_order`
- [ ] Заполнить начальными типами:
  - [ ] `security`
  - [ ] `deposit`
  - [ ] `crypto`
- [ ] Заложить возможность потом добавлять:
  - [ ] `bond`
  - [ ] `metal`
  - [ ] `reit`
  - [ ] `p2p`
  - [ ] `other`

### 3. Asset Catalog

- [ ] Создать таблицу `portfolio_assets`
- [ ] Поля:
  - [ ] `id`
  - [ ] `asset_type_code`
  - [ ] `symbol`
  - [ ] `name`
  - [ ] `currency_code`
  - [ ] `metadata jsonb`
  - [ ] `created_at`
- [ ] Разрешить `symbol` быть nullable, чтобы поддерживать ручной ввод неизвестных активов
- [ ] Определить правило:
  - [ ] известный инструмент можно выбрать из справочника;
  - [ ] неизвестный инструмент можно завести вручную.

### 4. Portfolio Positions

- [x] Создать таблицу `portfolio_positions`
- [ ] Поля:
  - [ ] `id`
  - [ ] `owner_type`
  - [ ] `owner_user_id`
  - [ ] `owner_family_id`
  - [ ] `investment_account_id`
  - [ ] `asset_id nullable`
  - [ ] `asset_type_code`
  - [ ] `title`
  - [ ] `status`
  - [ ] `opened_at`
  - [ ] `closed_at nullable`
  - [ ] `base_currency_code`
  - [ ] `metadata jsonb`
  - [ ] `created_by_user_id`
  - [ ] `created_at`
- [ ] Check constraints:
  - [ ] owner consistency
  - [ ] `status in ('open', 'closed')`
- [x] Проверить, что `investment_account_id` указывает только на `account_kind = 'investment'`

### 5. Portfolio Events

- [x] Создать таблицу `portfolio_events`
- [ ] Поля:
  - [ ] `id`
  - [ ] `position_id`
  - [ ] `event_type`
  - [ ] `event_at`
  - [ ] `quantity nullable`
  - [ ] `price nullable`
  - [ ] `amount nullable`
  - [ ] `currency_code`
  - [x] `linked_operation_id nullable`
  - [ ] `comment nullable`
  - [ ] `metadata jsonb`
  - [ ] `created_by_user_id`
  - [ ] `created_at`
- [ ] Начальные типы событий:
  - [x] `open`
  - [x] `top_up`
  - [ ] `partial_close`
  - [x] `close`
  - [x] `income`
  - [ ] `fee`
  - [x] `adjustment`
- [ ] В `metadata` поддержать будущие поля без миграций

### 6. Optional Read Model

- [ ] Решить, нужен ли materialized/read-side слой для портфеля с самого начала
- [ ] Если нужен, создать `current_portfolio_positions`
- [ ] Иначе на MVP считать агрегаты из `portfolio_positions + portfolio_events`

## Ledger and Budget Integration

### 7. Operation Types

- [ ] Расширить `operations.type`
- [ ] Добавить типы верхнего уровня:
  - [ ] `investment_transfer`
  - [x] `investment_trade`
  - [x] `investment_income`
  - [x] `investment_adjustment`
- [ ] Обновить:
  - [x] check constraint в `operations`
  - [x] `get__operations_history`
  - [ ] аналитические SQL-функции
  - [x] frontend фильтры операций

### 8. Transfer Rules Between Cash and Investment

- [ ] Спроектировать SQL-функцию `put__transfer_to_investment_account`
- [ ] Спроектировать SQL-функцию `put__transfer_from_investment_account`
- [ ] Для `cash -> investment`:
  - [ ] списать деньги с cash-счета;
  - [ ] зачислить деньги на investment-счет;
  - [ ] уменьшить бюджет.
- [ ] Для `investment -> cash`:
  - [ ] списать деньги с investment-счета;
  - [ ] зачислить деньги на cash-счет;
  - [ ] увеличить бюджет.
- [ ] Запретить переводы:
  - [ ] `investment -> investment` через cash-budget функцию;
  - [ ] `cash -> cash` через investment transfer API.

### 9. Hidden Budget System Category

- [ ] Решить, нужна ли скрытая системная категория для консистентности ledger
- [ ] Рекомендуемое имя/код:
  - [ ] `Investment Transit`
  - [ ] или `Invested Reserve`
- [ ] Если вводим такую категорию:
  - [ ] добавить `system_code` в `categories`
  - [ ] перестать завязываться на `name = 'Unallocated'` и `name = 'FX Result'`
  - [ ] перевести системные категории на явные коды:
    - [ ] `unallocated`
    - [ ] `fx_result`
    - [ ] `investment_transit`
- [ ] Скрыть эту категорию из обычного UI

## Backend Checklist

### 10. Storage Layer

- [x] Добавить новые методы в `storage/ledger.py`
- [x] Добавить новые методы в `storage/reports.py`
- [ ] Сохранить существующий стиль: SQL functions как основной write/read слой

### 11. SQL Write Functions

- [x] `put__create_investment_account`
- [ ] `put__transfer_to_investment_account`
- [ ] `put__transfer_from_investment_account`
- [x] `put__open_portfolio_position`
- [x] `put__top_up_portfolio_position`
- [x] `put__close_portfolio_position`
- [x] `put__record_portfolio_income`
- [x] `put__delete_portfolio_position`
- [x] `put__cancel_portfolio_income`
- [ ] `put__record_portfolio_event`
- [x] `put__reverse_investment_operation` или явное решение временно не поддерживать reversal

### 12. SQL Read Functions

- [x] `get__investment_accounts`
- [x] `get__portfolio_summary`
- [x] `get__portfolio_positions`
- [x] `get__portfolio_position`
- [x] `get__portfolio_events`
- [ ] `get__investment_operations_history`
- [ ] `get__investment_asset_types`

### 13. FastAPI Routers

- [x] Добавить новый router `portfolio`
- [ ] Добавить endpoints:
- [ ] `GET /api/v1/portfolio/accounts`
- [ ] `POST /api/v1/portfolio/accounts`
  - [x] `GET /api/v1/portfolio/summary`
  - [x] `GET /api/v1/portfolio/positions`
  - [x] `POST /api/v1/portfolio/positions`
  - [x] `POST /api/v1/portfolio/positions/{id}/top-up`
  - [x] `POST /api/v1/portfolio/positions/{id}/close`
  - [x] `POST /api/v1/portfolio/positions/{id}/income`
  - [x] `DELETE /api/v1/portfolio/positions/{id}`
  - [x] `GET /api/v1/portfolio/positions/{id}/events`
  - [x] `POST /api/v1/portfolio/events/{id}/cancel`
  - [ ] `POST /api/v1/portfolio/transfers/in`
  - [ ] `POST /api/v1/portfolio/transfers/out`
- [x] Подключить router в [main.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend/app/main.py)

### 14. Validation Rules

- [ ] Проверять доступ пользователя к owner scope
- [ ] Проверять, что позиция принадлежит тому же owner, что и investment account
- [ ] Проверять, что cash и investment переводятся только внутри допустимых owner-контуров
- [ ] Проверять статус позиции перед `close`
  - [x] проверка уже есть
- [ ] Проверять допустимость типа события для типа актива
- [ ] Разрешить неизвестные будущие типы активов через справочник, а не через hardcode в API

## Frontend Checklist

### 15. Navigation

- [x] Добавить страницу `portfolio`
- [x] Обновить `Page` union в [Layout.tsx](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/components/Layout.tsx)
- [x] Обновить `PAGE_IDS` в [App.tsx](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/App.tsx)
- [x] Добавить пункт навигации `Портфель`

### 16. Types and API Client

- [x] Добавить TS-типы:
  - [ ] `InvestmentAccount`
  - [ ] `PortfolioAssetType`
  - [x] `PortfolioPosition`
  - [x] `PortfolioEvent`
  - [x] `PortfolioSummary`
- [x] Добавить API-функции в [api.ts](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/api.ts)

### 17. Portfolio Page

- [x] Блок со списком investment-счетов
- [x] Блок со сводкой по портфелю
- [x] Список открытых позиций
- [x] Список закрытых позиций
- [ ] Фильтры:
  - [ ] по счету
  - [ ] по типу актива
  - [ ] по статусу
- [ ] Карточка позиции с действиями:
  - [x] `Закрыть`
  - [x] `Начислить доход`
  - [x] `Добавить событие`
  - [x] `Пополнить позицию`

### 18. Position Creation UX

- [x] Форма создания позиции
- [ ] Поля MVP:
  - [x] инвестиционный счет
  - [x] тип актива
  - [x] название
  - [x] валюта
  - [x] сумма вложения
  - [x] дата открытия
  - [x] комментарий
- [ ] Дополнительные поля по типу актива сначала хранить в `metadata`
- [ ] Не блокировать создание позиции, если инструмент не найден в справочнике

### 19. Investment Operations Tab

- [x] В [Operations.tsx](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/pages/Operations.tsx) добавить отдельную вкладку `Инвестиции`
- [ ] Показывать там:
  - [x] переводы в инвестиции
  - [x] переводы из инвестиций
  - [x] открытие позиции
  - [x] закрытие позиции
  - [x] дивиденды / проценты / иные доходы
- [x] Добавить отдельные фильтры по investment operation type
- [x] Не смешивать инвестиционные операции с расходной аналитикой по категориям

### 20. Cash Transfer UX

- [ ] На cash-счете дать действие `Перевести в инвестиции`
- [ ] На investment-счете дать действие `Вывести на счет`
- [ ] Для перевода в инвестиции разрешить выбор:
  - [ ] исходного cash-счета
  - [ ] investment-счета
  - [ ] категории-источника бюджета или `Unallocated`
- [ ] Для вывода из инвестиций разрешить выбор целевого cash-счета

## Analytics and Reporting

### 21. Portfolio Metrics

- [x] Показать по investment-счету:
  - [x] cash balance
  - [x] invested principal
  - [x] realized income
  - [x] current position count
- [ ] Показать по позиции:
  - [x] invested amount
  - [ ] returned amount
  - [ ] income amount
  - [x] status

### 22. Valuation Strategy

- [ ] Сразу отделить:
  - [ ] ledger amount
  - [ ] market valuation
- [ ] На MVP сделать manual valuation optional
- [ ] Под future stage заложить таблицу `asset_price_snapshots`
- [ ] Не смешивать market valuation с бюджетом

## Migration Strategy

### 23. Safe Rollout

- [ ] Сначала добавить nullable/new columns без ломки старого поведения
- [ ] Потом добавить новые таблицы портфеля
- [ ] Потом новые SQL-функции и API
- [ ] Потом новый UI
- [ ] Потом скрытые системные категории и refactor system codes

### 24. Backward Compatibility

- [ ] Старые cash-счета должны автоматически иметь `account_kind = 'cash'`
- [ ] Старые операции должны продолжать читаться без изменений
- [ ] Старый дашборд не должен показывать investment-счета как обычные cash-счета
- [ ] `get__bank_snapshot` и dashboard logic обновить с учетом `account_kind`

## Testing Checklist

### 25. SQL / Ledger Tests

- [ ] Перевод `cash -> investment` корректно меняет bank и budget
- [ ] Перевод `investment -> cash` корректно меняет bank и budget
- [ ] Внутренние portfolio events не меняют обычный бюджет
- [ ] Доход на investment-счет не меняет бюджет
- [ ] Доход с выводом на cash-счет меняет бюджет
- [ ] Нельзя записать позицию в чужой investment-счет
- [ ] Нельзя закрыть уже закрытую позицию

### 26. API Tests

- [ ] Проверка owner access
- [ ] Проверка валидации account kind
- [ ] Проверка новых investment endpoints
- [ ] Проверка истории инвестиционных операций

### 27. Frontend Tests / QA

- [ ] Навигация на страницу `Портфель`
- [ ] Создание инвестиционного счета
- [ ] Перевод в инвестиции
- [ ] Создание позиции
- [ ] Начисление дохода
- [ ] Закрытие позиции
- [ ] Вывод обратно на cash-счет
- [ ] Корректное отображение в истории операций

## Recommended Delivery Phases

### Phase 1. Foundation

- [x] `account_kind` в `bank_accounts`
- [x] read API для investment-счетов
- [x] базовые переводы `cash <-> investment`
- [ ] скрытая системная категория или эквивалентный механизм консистентности

### Phase 2. Portfolio MVP

- [ ] `investment_asset_types`
- [x] `portfolio_positions`
- [x] `portfolio_events`
- [x] создание позиции вручную
- [x] пополнение позиции
- [x] закрытие позиции
- [x] начисление дохода
- [x] страница `Портфель`

### Phase 3. Operations Integration

- [x] отдельная вкладка инвестиционных операций
- [x] фильтры
- [x] улучшенные подписи событий
- [x] безопасная стратегия отмены операций

### Phase 4. Extensibility and Analytics

- [ ] `system_code` для системных категорий
- [ ] optional valuation snapshots
- [ ] richer metadata validation
- [ ] поддержка новых типов активов без ломки схемы

## Open Decisions

- [ ] Нужен ли один investment account на owner по умолчанию или несколько
- [ ] Делать ли investment cash как часть `current_bank_balances` без отдельной проекции
- [ ] Поддерживать ли reversal для investment операций на MVP
- [ ] Нужен ли partial close на MVP
- [ ] Нужны ли комиссии на MVP
- [ ] Нужна ли ручная переоценка на MVP
- [ ] Нужен ли справочник активов уже на первой итерации

## First Implementation Slice

Если идти самым практичным путем, первый рабочий инкремент должен быть таким:

- [x] добавить `account_kind` в `bank_accounts`
- [x] обновить dashboard и bank account API
- [x] реализовать перевод `cash -> investment`
- [x] реализовать перевод `investment -> cash`
- [x] добавить новую страницу `Портфель`
- [x] добавить простую ручную позицию с типом `security | deposit | crypto`
- [x] добавить `close position`
- [x] добавить `record income`
- [x] сделать открытие/закрытие позиции с реальным движением денег на investment-счете
- [x] добавить `top_up position`
- [x] добавить сводку по investment-счетам
