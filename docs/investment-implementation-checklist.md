# Investment Module Status

Этот файл больше не про первоначальный MVP-план, а про текущее состояние инвестиционного модуля и оставшийся backlog.

## Что уже собрано

### Домен и БД

- [x] `bank_accounts.account_kind = cash | investment`
- [x] ручные инвестиционные счета как часть общей модели bank accounts
- [x] таблица `portfolio_positions`
- [x] таблица `portfolio_events`
- [x] таблица `external_connections`
- [x] идемпотентность импорта через `bank_entries.external_id/import_source`
- [x] идемпотентность импорта через `portfolio_events.external_id/import_source`
- [x] debug-таблицы `tinkoff_api_debug_snapshots` и `tinkoff_api_debug_items`

### SQL / storage

- [x] write-path портфеля через SQL-функции
- [x] read-path портфеля через SQL-функции
- [x] T-Bank connection CRUD через SQL-функции
- [x] T-Bank read-side storage wrapper в [storage/tinkoff.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage/tinkoff.py)
- [x] T-Bank write-side orchestration в [storage/tinkoff_sync.py](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/storage/tinkoff_sync.py)

### Портфель

- [x] создание ручной позиции
- [x] пополнение позиции
- [x] частичное закрытие позиции
- [x] полное закрытие позиции
- [x] запись дохода
- [x] запись комиссии
- [x] отмена дохода
- [x] список открытых и закрытых позиций
- [x] фильтрация по типу актива
- [x] группировка и переключение по инвестиционным счетам
- [x] аналитика прямо на странице портфеля
- [x] отдельная модалка операций портфеля

### Операции и навигация

- [x] инвестиционные операции вынесены из банковой аналитики dashboard
- [x] dashboard показывает банковую историю без внутренней жизни портфеля
- [x] переводы `cash <-> investment` остаются в общей истории счетов
- [x] page swipe синхронизирован с основным навигационным меню

### Интеграция с T-Bank

- [x] подключение нескольких broker accounts одним токеном
- [x] preview перед импортом
- [x] ручные решения по пополнениям
- [x] ручные решения по выводам
- [x] автоматический импорт `buy/sell/dividend/coupon/fee/tax/bond repayment`
- [x] запись реальной даты операции из T-Bank в `operations.created_at`
- [x] opening cash seed, если история не покрывает ранний остаток
- [x] reconciliation текущих количеств открытых позиций
- [x] recovery missing current positions из текущего портфеля брокера
- [x] live prices для открытых позиций
- [x] локальный кэш логотипов инструментов
- [x] человекочитаемые названия и metadata инструмента через `GetInstrumentBy`

## Что ещё остаётся сделать

### Технический backlog

- [ ] формализовать автоматический backfill/repair для уже старых импортов без полного reimport
- [ ] покрыть T-Bank sync регрессионными тестами
- [ ] добавить smoke-тесты для SQL-функций портфеля
- [ ] описать и автоматизировать rollout миграций на существующие БД

### Доменный backlog

- [ ] полноценная event-модель для корпоративных действий вместо частичного recovery через reconciliation
- [ ] richer asset registry, если понадобится отдельный справочник инструментов
- [ ] отдельные snapshots/price history, если понадобится историческая аналитика по valuation
- [ ] более явная модель returned principal / realized result по позиции в UI

### UX backlog

- [ ] цветовые индикаторы/бейджи на вкладках `Вводы/Выводы` в T-Bank sync
- [ ] более явная индикация unresolved ручных решений в модалке синка
- [ ] отдельный maintenance action для "обновить metadata инструмента" без переимпорта истории

## Текущее source of truth

### Таблицы

- [infra/db/Scripts/budgeting/tb/bank_accounts.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/tb/bank_accounts.sql)
- [infra/db/Scripts/budgeting/tb/portfolio_positions.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/tb/portfolio_positions.sql)
- [infra/db/Scripts/budgeting/tb/portfolio_events.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/tb/portfolio_events.sql)
- [infra/db/Scripts/budgeting/migrations/018_external_connections.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/018_external_connections.sql)
- [infra/db/Scripts/budgeting/migrations/019_tinkoff_api_debug_dump.sql](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/infra/db/Scripts/budgeting/migrations/019_tinkoff_api_debug_dump.sql)

### Документация

- [README.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/README.md)
- [docs/tinkoff-integration.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/docs/tinkoff-integration.md)
- [BUSINESS_LOGIC.md](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/BUSINESS_LOGIC.md)
- [DATA_MODEL.dbml](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/DATA_MODEL.dbml)
