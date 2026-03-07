# Bank and Budget Data Model

Схема данных для модели, где:
- у пользователя есть общий мультивалютный банк;
- категории являются только бюджетными конвертами в базовой валюте пользователя;
- группы остаются категориями и распределяют бюджет по дочерним категориям;
- расход можно отнести на любую категорию, но валюта физически списывается из общего банка;
- изменение рыночного курса не меняет категории и не создает бухгалтерских операций;
- текущая стоимость всех денег в любой валюте считается только на чтение, по запросу.

## Основная идея

Есть два независимых слоя учета:

- `bank_*` таблицы отвечают за реальные деньги и валютные лоты;
- `budget_*` таблицы отвечают за бюджет по категориям в базовой валюте пользователя.

Это позволяет:
- не привязывать USD/EUR/CNY к конкретной категории;
- тратить `50 USD` с категории `Путешествия`, если в банке есть `50 USD`;
- уменьшать категорию не на `50 USD`, а на историческую себестоимость этих `50 USD` в базовой валюте.

## Диаграмма связей

```mermaid
erDiagram
    CURRENCIES {
        char3 code PK
        text name
        smallint scale
    }

    USERS {
        bigint id PK
        char3 base_currency_code FK
        text username
        timestamptz created_at
    }

    CATEGORIES {
        bigint id PK
        bigint user_id FK
        text name
        text kind
        boolean is_active
        timestamptz created_at
    }

    GROUP_MEMBERS {
        bigint group_id PK, FK
        bigint child_category_id PK, FK
        numeric share
    }

    BANK_ACCOUNTS {
        bigint id PK
        bigint user_id FK
        text name
        boolean is_primary
        boolean is_active
        timestamptz created_at
    }

    OPERATIONS {
        bigint id PK
        bigint user_id FK
        text type
        bigint reversal_of_operation_id FK
        text comment
        timestamptz created_at
    }

    BANK_ENTRIES {
        bigint id PK
        bigint operation_id FK
        bigint bank_account_id FK
        char3 currency_code FK
        numeric amount
    }

    BUDGET_ENTRIES {
        bigint id PK
        bigint operation_id FK
        bigint category_id FK
        char3 currency_code FK
        numeric amount
    }

    FX_LOTS {
        bigint id PK
        bigint bank_account_id FK
        char3 currency_code FK
        numeric amount_initial
        numeric amount_remaining
        numeric buy_rate_in_base
        numeric cost_base_initial
        numeric cost_base_remaining
        bigint opened_by_operation_id FK
        timestamptz created_at
    }

    LOT_CONSUMPTIONS {
        bigint id PK
        bigint operation_id FK
        bigint lot_id FK
        numeric amount
        numeric cost_base
    }

    FX_RATE_SNAPSHOTS {
        bigint id PK
        char3 base_currency_code FK
        char3 quote_currency_code FK
        numeric rate
        timestamptz fetched_at
        text source
    }

    USERS }o--|| CURRENCIES : "base currency"
    CATEGORIES }o--|| USERS : "belongs to"
    GROUP_MEMBERS }o--|| CATEGORIES : "group"
    GROUP_MEMBERS }o--|| CATEGORIES : "child"
    BANK_ACCOUNTS }o--|| USERS : "belongs to"
    OPERATIONS }o--|| USERS : "belongs to"
    OPERATIONS }o--o| OPERATIONS : "reversal of"
    BANK_ENTRIES }o--|| OPERATIONS : "part of"
    BANK_ENTRIES }o--|| BANK_ACCOUNTS : "changes balance of"
    BANK_ENTRIES }o--|| CURRENCIES : "in currency"
    BUDGET_ENTRIES }o--|| OPERATIONS : "part of"
    BUDGET_ENTRIES }o--|| CATEGORIES : "changes budget of"
    BUDGET_ENTRIES }o--|| CURRENCIES : "base currency only"
    FX_LOTS }o--|| BANK_ACCOUNTS : "stored in"
    FX_LOTS }o--|| CURRENCIES : "lot currency"
    FX_LOTS }o--|| OPERATIONS : "opened by"
    LOT_CONSUMPTIONS }o--|| OPERATIONS : "consumed by"
    LOT_CONSUMPTIONS }o--|| FX_LOTS : "from lot"
    FX_RATE_SNAPSHOTS }o--|| CURRENCIES : "base"
    FX_RATE_SNAPSHOTS }o--|| CURRENCIES : "quote"
```

## Кратко по таблицам

- `currencies` — справочник валют.
- `users` — пользователь и его базовая валюта.
- `categories` — бюджетные категории пользователя: `regular`, `group`, `income`, `system`.
- `group_members` — состав групп и доли распределения.
- `bank_accounts` — реальные счета пользователя; в первой версии можно иметь один основной счет.
- `operations` — шапка бизнес-операции: `income`, `allocate`, `group_allocate`, `exchange`, `expense`, `transfer`, `reversal`.
- `bank_entries` — фактические изменения остатков банка по валютам.
- `budget_entries` — изменения бюджетов категорий, всегда в базовой валюте пользователя.
- `fx_lots` — валютные лоты банка с исторической себестоимостью.
- `lot_consumptions` — какие лоты были списаны при расходе, переводе или обмене.
- `fx_rate_snapshots` — рыночные курсы для отчетной оценки в любой валюте.

## Как работает эта модель

### Доход

- увеличивает реальные деньги в `bank_entries`;
- увеличивает доступный к распределению бюджет в системной категории, например `Unallocated`, через `budget_entries`.

### Распределение по категориям

- двигает бюджет между категориями в базовой валюте;
- банк при этом не меняется.

### Обмен валюты

- меняет только структуру денег в банке;
- категории не меняет;
- при покупке небазовой валюты создает `fx_lots`;
- при продаже небазовой валюты списывает лоты по `FIFO`.

### Расход

- проверяет наличие нужной валюты в банке;
- если валюты недостаточно, операция запрещается;
- списывает валюту из банка;
- считает историческую себестоимость списанного объема в базовой валюте;
- на эту себестоимость уменьшает выбранную категорию через `budget_entries`.

### Reversal

- не удаляет старую операцию;
- создает новую операцию с типом `reversal`;
- зеркалит `bank_entries` и `budget_entries`;
- восстанавливает или повторно закрывает лоты на основании `lot_consumptions`.

## Важные правила

- Категории не переоцениваются при изменении рынка.
- Нереализованная курсовая разница не попадает в категории.
- Рыночный курс используется только для отчетов.
- Текущая стоимость всех денег в `RUB`, `USD`, `CNY` и любой другой валюте считается по запросу, без записи новых операций.
