# Интеграция с T-Bank / Тинькофф Инвестиции

## Что реализовано сейчас

Интеграция работает как ручной импорт истории и текущих котировок по инвестиционным счетам T-Bank.

Поддерживаются:

- подключение нескольких T-Bank счетов одним токеном;
- независимая привязка каждого broker account к нашему `bank_accounts.account_kind = 'investment'`;
- preview перед записью в БД;
- ручная разметка пополнений и выводов;
- автоматический импорт покупок, продаж, дивидендов, купонов, комиссий, налогов и погашений облигаций;
- идемпотентность через `external_id + import_source`;
- live-цены по открытым позициям;
- локальный кэш логотипов инструментов;
- debug-дамп сырых ответов API в отдельные таблицы.

Интеграция не заменяет ручной портфель. Ручные и импортированные позиции могут сосуществовать на одном инвестиционном счете.

## Архитектура

### Backend

- REST-клиент T-Bank реализован в [storage/tinkoff_sync.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage/tinkoff_sync.py)
- HTTP-роуты находятся в [backend/app/routers/tinkoff.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/backend/app/routers/tinkoff.py)
- SQL read/write-path для T-Bank вынесен в [storage/tinkoff.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage/tinkoff.py)

Интеграция использует T-Bank REST API напрямую через `httpx`. Официальный Python SDK сейчас не используется.

### Storage / SQL

Python оркестрирует sync, но запись и чтение ключевых доменных данных идут через PostgreSQL-функции.

Актуальные T-Bank/read-side функции:

- `get__tinkoff_connections`
- `get__tinkoff_connection`
- `get__tinkoff_imported_ids`
- `get__tinkoff_live_price_rows`
- `get__open_portfolio_positions_for_account`
- `get__current_bank_balance_amount`
- `get__portfolio_position_trade_context`

Актуальные write-side функции:

- `put__upsert_tinkoff_connection`
- `set__deactivate_tinkoff_connection`
- `put__record_broker_input`
- `put__record_broker_transfer_in`
- `put__record_imported_cash_only`
- `put__record_bond_principal_repayment`
- `put__recover_portfolio_position_from_import`
- `set__mark_bank_entry_imported`
- `set__mark_portfolio_event_imported`
- `set__merge_portfolio_position_metadata`
- `set__reconcile_portfolio_position_quantity`
- `set__touch_external_connection_last_synced`
- `set__ensure_portfolio_position_clean_amount`
- `set__increment_portfolio_bond_cost_metadata`

## Пользовательский поток

### 1. Подключение

1. На странице настроек пользователь вводит токен.
2. Backend вызывает `GetAccounts`.
3. Пользователь выбирает, какие broker accounts привязать к каким нашим investment accounts.
4. Для каждого broker account создается или обновляется запись в `budgeting.external_connections`.

Текущее удаление подключения мягкое: запись не удаляется физически, а деактивируется через `is_active = false`.

### 2. Preview

`GET /api/v1/tinkoff/preview/{connection_id}`

Preview ничего не пишет в БД. Он:

- получает историю операций по счету;
- сортирует операции по времени;
- дедуплицирует синтетические дубли;
- проверяет, какие `external_id` уже были импортированы;
- делит результат на:
  - `deposits`
  - `withdrawals`
  - `auto_operations`

В UI ручные движения сейчас разбиты на две вкладки:

- `Вводы`
- `Выводы`

Для каждой вкладки можно применить решение ко всем операциям сразу или разметить каждую отдельно.

### 3. Apply

`POST /api/v1/tinkoff/apply/{connection_id}`

`apply` работает в одной транзакции и делает:

1. повторно тянет историю из T-Bank;
2. подгружает метаданные инструментов;
3. рассчитывает стартовый cash seed, если история не покрывает ранний остаток;
4. применяет ручные решения по `input/output`;
5. автоматически применяет остальные операции;
6. переснимает текущие количества по открытым бумагам через `GetPositions/GetPortfolio`;
7. обновляет `external_connections.last_synced_at`.

Если что-то падает, транзакция откатывается целиком.

## Ручные решения по движениям денег

### Пополнения

Для каждого `input` доступны варианты:

- `external` — внешнее пополнение брокерского счета;
- `transfer` — перевод с нашего cash-счета;
- `already_recorded` — операция уже отражена в боте, нужен только idempotency marker.

### Выводы

Для каждого `output` доступны варианты:

- `external` — внешний вывод с брокерского счета;
- `transfer` — перевод на наш cash-счет;
- `already_recorded` — операция уже отражена в боте.

Если пользователь пытается нажать `Применить`, пока не выбраны все ручные решения, UI показывает отдельный warning popup внутри модалки.

## Маппинг операций T-Bank

### Ручные

- `OPERATION_TYPE_INPUT` -> manual `deposit resolution`
- `OPERATION_TYPE_OUTPUT` -> manual `withdrawal resolution`

### Автоматические

- `OPERATION_TYPE_BUY` -> открытие новой позиции или `top_up`
- `OPERATION_TYPE_SELL` -> `partial_close` или `close`
- `OPERATION_TYPE_DIVIDEND` -> `income`
- `OPERATION_TYPE_COUPON` -> `income`
- `OPERATION_TYPE_BROKER_FEE` и fee-like типы -> `fee`
- `OPERATION_TYPE_TAX*` -> fee или cash-only adjustment в зависимости от контекста
- `OPERATION_TYPE_BOND_REPAYMENT` -> частичное погашение principal
- `OPERATION_TYPE_BOND_REPAYMENT_FULL` -> полное закрытие облигационной позиции

### Частично поддержанные / служебные кейсы

Некоторые корпоративные действия T-Bank не приходят как обычные `buy/sell/open/close`.
Для таких кейсов есть recovery через текущее состояние портфеля брокера:

- синк умеет восстанавливать недостающую открытую позицию из `GetPortfolio`;
- после apply выполняется reconciliation количества;
- это позволяет держать БД ближе к фактическому состоянию счета, даже если история API неполная.

## Котировки и логотипы

### Live prices

Backend отдает live-цены через:

- `GET /api/v1/tinkoff/live-prices`

Логика такая:

1. пытаемся взять цены по активным T-Bank подключениям;
2. сначала используем `GetPortfolio`;
3. если чего-то не хватило, используем `GetLastPrices`;
4. на фронте это накладывается поверх MOEX fallback.

Важно:

- live prices используются только для оценки открытых позиций;
- агрегаты по счету и история операций должны сходиться из нашей БД, а не из T-Bank account summary.

### Облигации

Для облигаций сейчас различаются:

- `price/current_value` — текущая рыночная оценка;
- `clean_price/clean_current_value` — чистая цена без накопленного купонного дохода, если она доступна.

В БД для bond cost basis поддерживаются специальные metadata-поля:

- `clean_amount_in_base`
- `accrued_interest_in_base`

### Логотипы

Логотипы не тянутся напрямую с CDN на каждый рендер.

Реализован локальный cache endpoint:

- `GET /api/v1/tinkoff/instrument-logo/{logo_name}`

Backend скачивает PNG один раз, сохраняет локально и дальше отдает из своего кэша.

## Таблицы и колонки БД

### Основные таблицы

#### `budgeting.external_connections`

Универсальная таблица внешних интеграций.

Ключевые поля:

- `provider`
- `provider_account_id`
- `linked_account_id`
- `credentials`
- `settings`
- `last_synced_at`
- `is_active`
- `owner_type / owner_user_id / owner_family_id`

Для T-Bank одна строка соответствует одному broker account.

#### `budgeting.portfolio_positions`

Открытые и закрытые позиции инвестиционного портфеля.

Для импортированных T-Bank бумаг в `metadata` обычно лежат:

- `figi`
- `instrument_uid`
- `position_uid`
- `asset_uid`
- `ticker`
- `class_code`
- `exchange`
- `logo_name`
- `security_kind`
- `moex_market`
- `import_source = "tinkoff"`
- bond-specific cost metadata

#### `budgeting.portfolio_events`

Журнал событий по позициям.

Для импортов используются:

- `external_id`
- `import_source`

#### `budgeting.bank_entries`

Bank ledger инвестиционного счета и cash-счетов, связанных с импортом пополнений/выводов.

Для идемпотентности тоже используются:

- `external_id`
- `import_source`

### Debug-таблицы

Опциональные таблицы для raw-дампа T-Bank API:

- `budgeting.tinkoff_api_debug_snapshots`
- `budgeting.tinkoff_api_debug_items`

Они создаются миграцией [019_tinkoff_api_debug_dump.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/019_tinkoff_api_debug_dump.sql).

Используются только для расследования проблем импорта и не участвуют в обычном runtime.

### Поддерживающие миграции

Для уже существующих БД, кроме базового [018_external_connections.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/018_external_connections.sql), важны ещё:

- [019_ensure_broker_op_types.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/019_ensure_broker_op_types.sql) — гарантирует `broker_input/broker_output` и idempotency columns;
- [019_tinkoff_api_debug_dump.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/019_tinkoff_api_debug_dump.sql) — создаёт debug-таблицы raw API dumps.

## Эндпоинты

Актуальные API-роуты:

- `POST /api/v1/tinkoff/accounts`
- `POST /api/v1/tinkoff/connect`
- `GET /api/v1/tinkoff/connections`
- `DELETE /api/v1/tinkoff/connections/{connection_id}`
- `GET /api/v1/tinkoff/preview/{connection_id}`
- `POST /api/v1/tinkoff/apply/{connection_id}`
- `GET /api/v1/tinkoff/live-prices`
- `GET /api/v1/tinkoff/instrument-logo/{logo_name}`

## Debug / диагностика

Для записи сырых ответов API есть скрипт:

- [storage/tinkoff_api_debug_dump.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage/tinkoff_api_debug_dump.py)

Он:

- обеспечивает наличие debug-таблиц;
- читает активные `external_connections`;
- сохраняет raw payload по `GetAccounts`, `GetPositions`, `GetPortfolio`, `GetOperationsByCursor`, `GetInstrumentBy`.

Пример запуска:

```bash
venv/bin/python storage/tinkoff_api_debug_dump.py \
  --db-host 127.0.0.1 \
  --db-port 5432 \
  --db-name budget \
  --db-user alex \
  --db-password secret
```

## Известные ограничения

- синк запускается только вручную;
- account summary T-Bank намеренно не используется как source of truth для наших totals;
- часть корпоративных действий восстанавливается через reconciliation, а не через полноценные domain events;
- fresh init контейнера не прогоняет миграции из `migrations/` автоматически, только базовые таблицы и SQL-функции;
- для уже импортированных данных некоторые исправления требуют переимпорта или targeted backfill.
