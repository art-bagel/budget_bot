# Currency-Aware Data Model

Ниже схема данных для версии, где:
- категория остается основной сущностью;
- группа тоже является категорией;
- базовая валюта задается на уровне пользователя;
- обычная категория может хранить несколько валют;
- валютные покупки хранятся как лоты с исторической себестоимостью в базовой валюте пользователя.

## Диаграмма связей

```mermaid
erDiagram
    USERS {
        bigint id PK
        char3 base_currency_code FK
        text username
        timestamptz created_at
    }

    CURRENCIES {
        char3 code PK
        text name
        smallint scale
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

    OPERATIONS {
        bigint id PK
        bigint user_id FK
        text type
        text comment
        timestamptz created_at
    }

    OPERATION_ENTRIES {
        bigint id PK
        bigint operation_id FK
        bigint category_id FK
        char3 currency_code FK
        numeric amount
    }

    FX_LOTS {
        bigint id PK
        bigint category_id FK
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
    OPERATIONS }o--|| USERS : "belongs to"
    OPERATION_ENTRIES }o--|| OPERATIONS : "part of"
    OPERATION_ENTRIES }o--|| CATEGORIES : "changes balance of"
    OPERATION_ENTRIES }o--|| CURRENCIES : "in currency"
    FX_LOTS }o--|| CATEGORIES : "stored in"
    FX_LOTS }o--|| CURRENCIES : "lot currency"
    FX_LOTS }o--|| OPERATIONS : "opened by"
    LOT_CONSUMPTIONS }o--|| OPERATIONS : "consumed by"
    LOT_CONSUMPTIONS }o--|| FX_LOTS : "from lot"
    FX_RATE_SNAPSHOTS }o--|| CURRENCIES : "base"
    FX_RATE_SNAPSHOTS }o--|| CURRENCIES : "quote"
```

## Кратко по таблицам

- `users` хранит пользователя и его базовую валюту.
- `currencies` хранит справочник валют.
- `categories` хранит все категории пользователя, включая группы.
- `group_members` хранит состав групп и доли распределения.
- `operations` хранит бизнес-операцию целиком.
- `operation_entries` хранит движения по категориям и валютам.
- `fx_lots` хранит валютные лоты по исторической себестоимости в базовой валюте пользователя.
- `lot_consumptions` хранит списание лотов при тратах и переводах.
- `fx_rate_snapshots` хранит рыночные курсы для оценки текущей стоимости остатков в базовой валюте пользователя.

## Основные правила модели

- `categories.kind = 'group'` не хранит деньги напрямую, а только распределяет пополнение по дочерним категориям.
- `categories.kind = 'regular'` может хранить сразу несколько валют.
- Обмен валюты внутри категории создает валютный лот в `fx_lots`.
- Курс обмена считается автоматически как `amount_from / amount_to`.
- Трата валюты списывает лоты по правилу `FIFO`.
- Баланс категории можно считать в двух видах: по исторической себестоимости и по текущему рыночному курсу.
