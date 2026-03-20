# Интеграция с Тинькофф Инвестиции

## Цель

Возможность вручную подтягивать операции из Тинькофф Инвестиции через API.
При импорте пополнений — всегда спрашивать пользователя как учесть операцию.
Все остальные операции (покупки, продажи, дивиденды, комиссии) — обрабатываются автоматически.

---

## Ключевые решения

### Ручные позиции остаются

Интеграция с Тинькофф не заменяет ручной ввод — только дополняет.
Все существующие функции портфеля (создать позицию, пополнить, записать доход, комиссию,
частично/полностью закрыть) работают как прежде.

Ручные и импортированные позиции сосуществуют на одном инвест счёте.
Различаются по полю `import_source`: `null` = ручной, `'tinkoff'` = импортирован.

> При первом подключении Тинькофф к счёту с уже существующими ручными позициями —
> система предложит сматчить позиции по тикеру, чтобы не создавать дубли.

### Несколько счетов Тинькофф (ИИС + брокерский)

Один токен Тинькофф даёт доступ ко всем счетам через `GetAccounts`.
При подключении пользователь выбирает какие счета подключать и к каким
нашим investment account их привязать.

В базе создаётся **один `external_connection` на каждый счёт Тинькофф**:

```
provider: 'tinkoff',  provider_account_id: '2000111111' → linked_account_id: [Мой ИИС]
provider: 'tinkoff',  provider_account_id: '2000222222' → linked_account_id: [Брокерский]
```

Токен хранится один раз. Синкать можно независимо по каждому счёту.
ИИС и брокерский не смешиваются — разный налоговый режим.

### UI подключения (шаг за шагом)

```
Шаг 1: Введи токен API
        [t.xxxxxxxxxxxxxxxxxx]

Шаг 2: Найдены счета Тинькофф:

        ИИС (2000111111)
        Привязать к: [Мой ИИС ▾]  или  [+ Создать новый счёт]

        Брокерский счёт (2000222222)
        Привязать к: [Брокерский ▾]  или  [+ Создать новый счёт]
        □ Не подключать этот счёт

        [Сохранить]
```

---

## Концепция

### Ручной запуск

Синхронизация запускается только вручную кнопкой "Подтянуть данные" на странице портфеля.
Автоматического/фонового синка нет.

### Поток синхронизации

```
[Подтянуть данные]
  → GET /tinkoff/preview/{connection_id}
  → показываем экран ревью (ничего в БД не пишем)
  → пользователь решает каждое пополнение
  → [Применить] → POST /tinkoff/apply/{connection_id}  (одна транзакция)
  → [Отмена]    → ничего не меняется
```

### Три варианта для каждого пополнения (INPUT)

| Вариант | Что происходит | Валидация |
|---|---|---|
| Внешнее пополнение | `broker_input`: инвест +X, никакой счёт не затрагивается | — |
| Перевод со счёта | `account_transfer`: выбранный счёт −X, инвест +X | баланс выбранного счёта ≥ X |
| Уже учтено в боте | ничего не создаётся, операция помечается как обработанная | баланс инвест счёта ≥ X (деньги там уже должны быть) |

### Маппинг операций Тинькофф → наша модель

| Тинькофф тип | Наша операция |
|---|---|
| `OPERATION_TYPE_INPUT` | требует решения пользователя (см. выше) |
| `OPERATION_TYPE_OUTPUT` | требует решения пользователя (симметрично) |
| `OPERATION_TYPE_BUY` | `portfolio_position.open` или `top_up` |
| `OPERATION_TYPE_SELL` (частичная) | `portfolio_position.partial_close` |
| `OPERATION_TYPE_SELL` (полная) | `portfolio_position.close` |
| `OPERATION_TYPE_DIVIDEND` | `portfolio_event.income` (income_kind='dividend') |
| `OPERATION_TYPE_COUPON` | `portfolio_event.income` (income_kind='coupon') |
| `OPERATION_TYPE_BROKER_FEE` | `portfolio_event.fee` |
| `OPERATION_TYPE_TAX_DIVIDEND` | `portfolio_event.fee` (налог) |

Идемпотентность: все операции хранят `external_id = tinkoff_operation_id` + `import_source = 'tinkoff'`.
Повторный синк одних и тех же операций не создаёт дублей.

---

## Изменения в базе данных

### Миграция 018: универсальные интеграции

```sql
-- Подключения к внешним брокерам/источникам данных
CREATE TABLE budgeting.external_connections (
    id                    bigserial PRIMARY KEY,
    owner_type            varchar(20) NOT NULL,
    owner_user_id         bigint REFERENCES users(id),
    owner_family_id       bigint REFERENCES families(id),
    provider              varchar(30) NOT NULL,        -- 'tinkoff', 'interactive_brokers', ...
    provider_account_id   text NOT NULL,               -- ID счёта на стороне брокера
    linked_account_id     bigint REFERENCES bank_accounts(id),
    credentials           jsonb NOT NULL DEFAULT '{}', -- токен (шифруется на уровне приложения)
    settings              jsonb NOT NULL DEFAULT '{}', -- {"sync_from": "2024-01-01"}
    last_synced_at        timestamptz,
    is_active             boolean NOT NULL DEFAULT true,
    created_at            timestamptz DEFAULT now(),
    CONSTRAINT chk_ext_conn_owner CHECK (
        (owner_type = 'user'   AND owner_user_id   IS NOT NULL AND owner_family_id IS NULL) OR
        (owner_type = 'family' AND owner_family_id IS NOT NULL AND owner_user_id   IS NULL)
    ),
    CONSTRAINT uq_ext_conn UNIQUE (provider, provider_account_id, owner_user_id, owner_family_id)
);

-- Идемпотентность: внешний ID на событиях портфеля
ALTER TABLE budgeting.portfolio_events
    ADD COLUMN external_id   text,
    ADD COLUMN import_source varchar(30);

CREATE UNIQUE INDEX uq_portfolio_events_external
    ON budgeting.portfolio_events (import_source, external_id)
    WHERE external_id IS NOT NULL;

-- Идемпотентность: внешний ID на банковских проводках (пополнения/выводы)
ALTER TABLE budgeting.bank_entries
    ADD COLUMN external_id   text,
    ADD COLUMN import_source varchar(30);

CREATE UNIQUE INDEX uq_bank_entries_external
    ON budgeting.bank_entries (import_source, external_id)
    WHERE external_id IS NOT NULL;

-- Новые типы операций для кэш-потоков брокера
-- Добавить в CHECK constraint на operations.type:
-- 'broker_input', 'broker_output'
```

---

## Новые API эндпоинты

### `POST /tinkoff/connect`
Сохранить токен + выбрать брокерский счёт → привязать к нашему investment account.

**Body:**
```json
{
  "token": "t.xxxxx",
  "provider_account_id": "2000123456",
  "linked_account_id": 7
}
```

### `GET /tinkoff/connections`
Список подключений пользователя.

### `DELETE /tinkoff/connections/{id}`
Удалить подключение.

### `GET /tinkoff/preview/{connection_id}`
Получить список операций из Тинькофф без записи в БД.

**Response:**
```json
{
  "deposits": [
    {
      "tinkoff_op_id": "xxx",
      "amount": 50000,
      "currency_code": "RUB",
      "date": "2024-03-18",
      "already_imported": false
    }
  ],
  "auto_operations": [
    {
      "tinkoff_op_id": "yyy",
      "type": "buy",
      "ticker": "SBER",
      "amount": 30000,
      "quantity": 10,
      "already_imported": false
    }
  ],
  "total_new": 12,
  "total_already_imported": 3
}
```

### `POST /tinkoff/apply/{connection_id}`
Применить синк с решениями по каждому пополнению. Всё в одной транзакции.

**Body:**
```json
{
  "deposit_resolutions": [
    {
      "tinkoff_op_id": "xxx",
      "resolution": "external",
      "source_account_id": null
    },
    {
      "tinkoff_op_id": "yyy",
      "resolution": "transfer",
      "source_account_id": 42
    },
    {
      "tinkoff_op_id": "zzz",
      "resolution": "already_recorded",
      "source_account_id": null
    }
  ]
}
```

**Валидация на сервере:**
- `transfer`: баланс `source_account_id` ≥ amount
- `already_recorded`: баланс investment account ≥ amount
- Любой сбой → rollback всего

---

## Новый Python модуль

`storage/tinkoff_sync.py` — изолированный класс, не трогает существующий `Ledger`.

```python
class TinkoffSync:
    def preview(self, token, tinkoff_account_id, linked_account_id, user_id) -> dict
    def apply(self, connection_id, deposit_resolutions, user_id) -> dict

    def _fetch_operations(self, token, account_id, since) -> list
    def _map_operation(self, op) -> dict        # тип + поля
    def _find_or_create_position(self, ...)     # по FIGI/ticker
    def _money_value_to_decimal(self, mv)       # units + nanos → Decimal
```

Зависимости: `tinkoff-investments` (официальный Python SDK).

---

## Фронтенд

### Страница настроек — новый раздел "Интеграции"

- Кнопка "Подключить Тинькофф"
- Форма: поле для токена + выбор брокерского счёта + привязка к нашему investment account
- Список подключений с кнопкой удаления

### Страница портфеля — кнопка синка

```
Мой брокерский счёт   [↻ Подтянуть данные]
                        последний раз: 20 мин назад
```

### Компонент TinkoffSyncDialog

Экран ревью с двумя секциями:

**Секция 1 — Пополнения (требуют решения)**

Для каждого пополнения — карточка с тремя radio-вариантами.
При выборе "Перевод со счёта" — dropdown со счетами + баланс + маркер хватает/не хватает.
При выборе "Уже учтено в боте" — проверка что на инвест счёте достаточно средств.
Кнопка "Применить" заблокирована пока есть нерешённые пополнения.

**Секция 2 — Автоматические операции**

Список: X покупок, Y дивидендов, Z комиссий — без интерактива.

**Кнопки:**
- `[Отмена]` — закрыть диалог без изменений
- `[Применить N операций]` — активна только когда все решены

---

## Чек-лист реализации

### База данных
- [x] Написать миграцию `018_external_connections.sql`
  - [x] Таблица `external_connections`
  - [x] `portfolio_events.external_id` + `import_source` + уникальный индекс
  - [x] `bank_entries.external_id` + `import_source` + уникальный индекс
  - [x] Добавить `broker_input`, `broker_output` в CHECK constraint `operations.type`
- [ ] Применить миграцию к БД

### Backend
- [x] Добавить зависимость `tinkoff-investments` в requirements
- [x] Написать `storage/tinkoff_sync.py`
  - [x] `_money_value_to_decimal()` — конвертер MoneyValue
  - [x] `_fetch_operations()` — получить операции из Тинькофф API с фильтром по дате
  - [x] `_map_operation()` — смаппить тип операции Тинькофф → наш тип
  - [x] `_find_or_create_position()` — найти позицию по FIGI или создать новую
  - [x] `preview()` — dry run, только читаем
  - [x] `apply()` — применить с решениями, одна транзакция
- [x] SQL функция `put__apply_broker_sync()` или вызывать существующие функции из Python (вызываем существующие из Python)
- [x] Новый роутер `backend/app/routers/tinkoff.py`
  - [x] `POST /tinkoff/connect`
  - [x] `GET /tinkoff/connections`
  - [x] `DELETE /tinkoff/connections/{id}`
  - [x] `GET /tinkoff/preview/{connection_id}`
  - [x] `POST /tinkoff/apply/{connection_id}`
- [x] Подключить роутер в `main.py`
- [x] Обработка ошибок Тинькофф API (невалидный токен, недоступен счёт, etc.)
- [x] Добавить нормализацию ошибок в `normalizeApiErrorMessage` на фронте

### Frontend
- [x] Добавить типы в `types.ts`
  - [x] `ExternalConnection`
  - [x] `TinkoffPreviewResponse`
  - [x] `DepositResolution`
- [x] Добавить API функции в `api.ts`
  - [x] `connectTinkoff()`
  - [x] `getTinkoffConnections()`
  - [x] `deleteTinkoffConnection()`
  - [x] `previewTinkoffSync()`
  - [x] `applyTinkoffSync()`
- [x] Компонент `TinkoffSyncDialog.tsx`
  - [x] Состояния: loading / review / applying / done / error
  - [x] Карточка для каждого пополнения с radio-вариантами
  - [x] Dropdown выбора счёта + показ баланса + валидация
  - [x] Валидация "Уже учтено" — проверка баланса инвест счёта (фронт показывает баланс + блокирует кнопку; сервер тоже валидирует)
  - [x] Блокировка кнопки "Применить" пока есть нерешённые пополнения
  - [x] Кнопка "Отмена" закрывает без изменений
  - [x] Секция автоматических операций (read-only список)
- [x] Страница настроек — раздел "Интеграции"
  - [x] Форма подключения Тинькофф (токен + выбор счёта)
  - [x] Список подключений
  - [x] Кнопка удаления подключения
- [x] Страница портфеля — кнопка синка
  - [x] Кнопка "Подтянуть данные" рядом с названием инвест счёта
  - [x] Показывать время последней синхронизации

### Тестирование
- [ ] Проверить идемпотентность — повторный применить не создаёт дублей
- [ ] Проверить валидацию баланса для "Перевод со счёта"
- [ ] Проверить валидацию баланса для "Уже учтено в боте"
- [ ] Проверить отмену — ничего не меняется в БД
- [ ] Проверить rollback при ошибке в середине применения
- [ ] Проверить синк ИИС и брокерского независимо друг от друга
- [ ] Проверить что ручные позиции не затронуты после синка
- [ ] Проверить матчинг ручных позиций по тикеру при первом подключении

---

## Порядок реализации

1. **Миграция 018** — база всего, без неё ничего не работает
2. **`storage/tinkoff_sync.py` preview()** — можно проверить без UI что API отдаёт
3. **Роутер preview эндпоинт** — можно тестировать через curl/Postman
4. **`TinkoffSyncDialog` без apply** — показываем что нашли, кнопка заблокирована
5. **`storage/tinkoff_sync.py` apply()** — основная логика записи
6. **Роутер apply эндпоинт** — подключаем apply
7. **TinkoffSyncDialog apply** — полный поток работает
8. **Настройки: форма подключения** — пользователь может сохранить токен
9. **Полировка** — ошибки, edge cases, UX деталей

