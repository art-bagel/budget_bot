# TON · авто-импорт on-chain истории — спецификация

> Цель: подтянуть транзакции TON-кошелька автоматически, чтобы пользователь не вводил руками. Этап 1 — только TON (нативка + Jetton-ы), DeFi трекаем только как **факт** входа/выхода (без переоценки внутри).

## Принципы

1. **Авто-импорт — это новый источник вызовов, а не новый учётный слой.** Классификатор on-chain события решает, что это (transfer / swap / DeFi open / DeFi close / income / расход), и зовёт **существующие** PUT-функции (`put__transfer_crypto_to_investment`, `put__swap_crypto_investment_asset`, `put__create_crypto_protocol_position`, ...). Никакой параллельной модели событий.
2. **Source of truth классификации — пользователь.** Сеть знает только «адрес X отправил Y адресу Z». Решение, что это значит для бюджета, всегда подтверждается пользователем хотя бы один раз — потом запоминается.
3. **Inbox-first UX.** Любое не-однозначное событие падает в очередь `pending_classifications`. Никакого «угадывания за пользователя». UX-паттерн копируется с уже работающего ручного флоу из ценных бумаг.
4. **Идемпотентность по `(network, tx_hash)`.** Повторный sync не создаёт дублей. Sync на адрес — инкрементальный по `last_synced_lt`.
5. **DeFi — только факт.** Whitelist протокольных контрактов. Send to whitelist → open. Receive from whitelist → close. Текущая стоимость и rewards остаются ручными (как сейчас, см. `set__update_crypto_protocol_position.sql`).
6. **DEX-свопы в MVP не парсятся из trace.** Пользователь видит две связанные tx в Inbox и явно «склеивает» их в swap. Это даёт корректность ценой одного клика и экономит парсер DEX-протоколов.
7. **Cost basis не выдумывается.** Для входящих переводов с неизвестных адресов пользователь явно выбирает источник — банковский лот, доход (entry_value=0) или внешний (live price).

## Источник данных

**TonAPI** (`tonapi.io/v2`):
- `GET /accounts/{address}/events?before_lt=&limit=` — лента событий по адресу с пагинацией по logical time.
- `GET /traces/{event_id}` — полное дерево internal messages (понадобится в Phase 2 для DEX).
- `GET /rates?tokens=ton,jetton:<addr>&currencies=rub,usd` — текущие цены.
- `GET /rates/chart?token=&currency=&start_date=&end_date=` — историческая цена для cost basis в момент tx.

Бесплатный тир TonAPI хватит на одного пользователя и десяток адресов. На случай rate limit — backoff + кеш.

## Модель данных

### Что добавляется

| Таблица | Назначение |
|---|---|
| `crypto_account_addresses` | TON-адреса, привязанные к investment account. Поля: `account_id`, `address`, `network_code='TON'`, `label`, `last_synced_lt`, `imported_from_lt` (граница «не тянуть старее») |
| `onchain_tx_cache` | Сырая лента событий из TonAPI. PK: `(network_code, event_id)`. Поля: `account_id`, `tx_hash`, `lt`, `event_at`, `raw_json`, `status` (`pending` / `auto_classified` / `user_classified` / `ignored`) |
| `pending_classifications` | Очередь решений пользователя. FK на `onchain_tx_cache`. Поля: `direction`, `counterparty_address`, `asset_id`, `quantity`, `suggested_kind`, `created_at`, `resolved_at` |
| `known_counterparties` | Address book. Поля: `user_id`, `address`, `network_code`, `kind` (`self_wallet` / `bank_in` / `bank_out` / `cex_deposit` / `cex_withdraw` / `defi` / `expense` / `income` / `peer`), `linked_account_id` (если `self_wallet`), `label`. Уникальный индекс `(user_id, network_code, address)` |
| `defi_protocol_contracts` | Seed-whitelist. Поля: `network_code`, `address`, `protocol_name`, `protocol_kind` (`staking` / `lending` / `lp` / `vault`), `action` (`open_on_send` / `close_on_receive` / `both`) |

Все таблицы создаются миграцией `032_ton_autoimport.sql` (после уже применённой `031_crypto_event_metadata_backfill.sql`).

### Что НЕ добавляется

- ❌ Параллельная таблица событий — все «настоящие» учётные движения по-прежнему в `portfolio_events`.
- ❌ Поле «raw tx hash» на `portfolio_events` (этап 1) — связь только через `operations.metadata.source_event_id` опционально.
- ❌ Multi-chain абстракция. Поля `network_code` оставлены для будущего, но логика only-TON.

## Классификатор · decision tree

Применяется к каждому новому on-chain событию по порядку, **первое совпадение выигрывает**:

1. **Counterparty — мой другой зарегистрированный TON-адрес** → авто-классификация:
   - оба адреса на одном investment account → пропустить (это внутреннее);
   - адреса на разных investment account → `transfer_between_investment_accounts`.
2. **Counterparty в `defi_protocol_contracts` + направление out** → `create_crypto_protocol_position` (факт open). Параметры берутся из tx: `qty`, `asset_id` (по jetton master или нативный TON), `protocol_name` из whitelist.
3. **Counterparty в `defi_protocol_contracts` + направление in** → `set__close_crypto_protocol_position` для последней открытой позиции в этом протоколе на этом счёте. Если таких > 1 — fallback в Inbox.
4. **Counterparty в `known_counterparties` с зафиксированным `kind`** → применить тот же flow, что был выбран в прошлый раз:
   - `bank_in` → `transfer_crypto_to_investment` с lot-picker'ом из банка (всё равно нужен выбор лота → Inbox, но pre-selected kind);
   - `bank_out` → `transfer_crypto_from_investment`;
   - `income` → `record_portfolio_income` с `entry_value_in_base = 0`;
   - `expense` → `record_crypto_expense` с live price;
   - `peer` → как `income` / `expense` в зависимости от направления, live price.
5. **Иначе** → `pending_classifications` со status `pending`.

### Когда `known_counterparties.kind = bank_in` и нужен лот

DeFi-факт можно решить полностью автоматом (нет cost basis выбора). Bank-related — нет: пользователь должен выбрать конкретный банковский крипто-лот, из которого выводятся средства. Поэтому даже «известный bank-адрес» всё равно создаёт запись в Inbox, но с предзаполненным `suggested_kind='bank_in'` и сразу открытым lot-picker'ом.

## Cost basis для авто-импорта

| Сценарий | `entry_value_in_base` | `source_kind` |
|---|---|---|
| transfer_in от своего адреса (другой account) | weighted-avg consumed_cost из source-позиции | `cross_account` |
| transfer_in от своего bank-адреса | banked cost_basis выбранного лота | `bank` |
| transfer_in от DeFi-контракта (close) | `cost_basis_carried × proportion` | `defi_return` |
| transfer_in income (айрдроп, чай от друга) | 0 (по умолчанию; пользователь может переопределить) | `income` |
| transfer_in от внешнего peer-адреса | live × qty на момент tx (TonAPI rates) | `peer_external` (новое значение) |
| swap_in (после ручного склеивания пары) | live × qty FROM на момент tx | `swap` |

Для exit-событий — те же правила, что в основном плане (`crypto-account-assets-defi-plan.md`, секция «Exit-события»).

## Inbox UX

### Карточка ожидающей классификации

```
══════════════════════════════════════════════════
  ← +50 TON   ·   12 May, 14:32                [↗]
  от UQAbc...XyZ
  ≈ 13 100 ₽   (live на момент tx)
──────────────────────────────────────────────────

  ЧТО ЭТО?

  ◯ Перевод из банка
     выбрать лот → [   …   ]

  ◯ Перевод со своего другого кошелька
     [ выбрать счёт ]

  ◯ Возврат из DeFi
     [ выбрать открытую позицию ]

  ◯ Доход (cost basis = 0 ₽)

  ◯ Перевод от человека (cost basis = live)

  ☐ Запомнить этот адрес как «<выбор>»
  ☐ Игнорировать эту tx

  [ Подтвердить ]
══════════════════════════════════════════════════
```

### Карточка для exit-направления (out)

```
══════════════════════════════════════════════════
  → −50 TON   ·   12 May, 14:32                [↗]
  на UQXyz...Abc
  ≈ 13 100 ₽   (live)
──────────────────────────────────────────────────

  ЧТО ЭТО?

  ◯ Перевод в банк
  ◯ Перевод на свой другой кошелёк
  ◯ Заморозка в DeFi (выбрать протокол)
  ◯ Расход (покупка, перевод человеку)

  ☐ Запомнить адрес
  [ Подтвердить ]
══════════════════════════════════════════════════
```

### Склеивание свопа

В Inbox два события (TON out + USDT in от другого адреса в близкое время) можно выделить чекбоксами и нажать `Склеить в swap`. UI зовёт `put__swap_crypto_investment_asset`, обе записи помечаются как `user_classified`.

## DeFi seed list (TON)

Записать в `defi_protocol_contracts` миграцией:

| Контракт | Протокол | Kind | Action |
|---|---|---|---|
| Tonstakers (stTON pool) | tonstakers | staking | both |
| TON Whales pool | whales | staking | both |
| TON Nominators pool (× топ-3) | nominators | staking | both |
| bemo (bmTON) | bemo | staking | both |
| Hipo (hTON) | hipo | staking | both |
| EVAA master | evaa | lending | both |
| Storm trading vault | storm | vault | both |
| DeDust router | dedust | (skip — это swap) | — |
| STON.fi router | stonfi | (skip — это swap) | — |

DEX-роутеры в DeFi whitelist **не пишем** — иначе свопы будут классифицированы как DeFi open. Они должны попадать в Inbox как обычные movement-ы, и пользователь склеивает пару в swap.

## API

### Новые endpoints

```
POST /api/v1/crypto/accounts/{account_id}/addresses
body: { address: str, label?: str, imported_from?: ISO_DATE }
→ { id, address, last_synced_lt: 0 }
```

```
GET /api/v1/crypto/accounts/{account_id}/addresses
→ List[{ id, address, label, last_synced_lt, last_synced_at }]
```

```
DELETE /api/v1/crypto/accounts/{account_id}/addresses/{id}
(не удаляет уже классифицированные tx, только перестаёт синкать)
```

```
POST /api/v1/crypto/accounts/{account_id}/sync
→ { fetched: int, auto_classified: int, pending: int }
```

```
GET /api/v1/crypto/pending-classifications
?account_id=&status=pending
→ List[PendingClassification]
```

```python
class PendingClassification(BaseModel):
    id: int
    account_id: int
    direction: Literal['in', 'out']
    counterparty_address: str
    counterparty_known_kind: Optional[str]   # если адрес уже в address book
    asset_id: int
    asset_symbol: str
    quantity: float
    live_value_in_base: float
    event_at: datetime
    tx_hash: str
    suggested_kind: Optional[str]
```

```
POST /api/v1/crypto/pending-classifications/{id}/resolve
body: {
  kind: 'bank_in' | 'bank_out' | 'cross_account' | 'defi_open' | 'defi_close'
        | 'income' | 'expense' | 'peer_in' | 'peer_out' | 'ignore',
  bank_lot_id?: int,            # для bank_in / bank_out
  target_account_id?: int,      # для cross_account
  defi_position_id?: int,       # для defi_close (если кандидатов > 1)
  defi_protocol_hint?: str,     # для defi_open
  remember_counterparty: bool,
  counterparty_label?: str,
}
→ { operation_id?: int, defi_position_id?: int }
```

```
POST /api/v1/crypto/pending-classifications/merge-as-swap
body: { out_id: int, in_id: int }
→ { operation_id: int }
```

### Существующие endpoints — переиспользуются

Классификатор и resolve-эндпоинт зовут уже работающие SQL-функции (`put__transfer_crypto_to_investment`, `put__swap_crypto_investment_asset`, `put__create_crypto_protocol_position`, `set__close_crypto_protocol_position`, `put__record_portfolio_income`, `put__record_crypto_expense`). Никакие из них не модифицируются.

## Реализация · slices

### Slice 1 · DB schema
**Что:** миграция `032_ton_autoimport.sql` со всеми пятью таблицами + seed `defi_protocol_contracts` для TON.
**Риск:** низкий, только новые таблицы.
**Оценка:** 1 день.

### Slice 2 · TonAPI клиент + ingestor
**Что:**
- `services/onchain/ton_client.py` — обёртка с retry/backoff.
- `services/onchain/ton_ingestor.py` — pull events с `last_synced_lt`, нормализация в universal `OnchainMovement` (direction, asset, qty, counterparty, ts), запись в `onchain_tx_cache` с дедупом.
- Парсинг jetton-трансферов: matching по jetton master address → `crypto_assets.contract_address`. Если неизвестный jetton — поднять флаг `unknown_jetton_master`, пропустить событие, написать в Inbox с типом «неизвестный jetton».
- Юнит-тесты на нормализацию из фикстур TonAPI.

**Зависит от:** Slice 1.
**Оценка:** 2 дня.

### Slice 3 · Classifier + dispatcher
**Что:**
- `services/onchain/classifier.py` — decision tree по списку выше. Чистая функция от `(movement, address_book, defi_whitelist)` → `ClassificationResult`.
- `services/onchain/dispatcher.py` — мостик от `ClassificationResult` к нужной PUT-функции; либо запись в `pending_classifications`.
- Юнит-тесты на каждую ветку.

**Зависит от:** Slice 2.
**Оценка:** 2 дня.

### Slice 4 · Backend API
**Что:** все 7 новых endpoint'ов из секции API. Pydantic-модели. Минимальные интеграционные тесты на sync + resolve.
**Зависит от:** Slice 3.
**Оценка:** 1.5 дня.

### Slice 5 · Frontend · address management
**Что:**
- В `Portfolio.tsx` (или `CryptoAccountSheet`, если выделится) — секция «TON-адреса» на crypto-счёте: список зарегистрированных, кнопка «Добавить», кнопка «Синхронизировать».
- Модалка добавления адреса (адрес + label + дата начала импорта).

**Зависит от:** Slice 4.
**Оценка:** 1 день.

### Slice 6 · Frontend · Inbox
**Что:**
- Новый экран `/inbox` (или bottom-sheet, если так укладывается в navbar).
- Список карточек pending-классификаций.
- Карточка resolve (см. UX-макет выше) с переключателем kind, lot-picker'ом для bank, выбором счёта/позиции для cross_account/defi_close.
- Multi-select + кнопка `Склеить в swap`.
- Чекбокс «запомнить адрес как ...» — при confirm делается запись в `known_counterparties`.

**Зависит от:** Slice 4.
**Оценка:** 3 дня.

### Slice 7 · Cron sync (опционально)
**Что:** фоновая задача sync раз в N минут на все зарегистрированные адреса. Можно использовать существующий планировщик, если уже есть.
**Зависит от:** Slice 4.
**Оценка:** 0.5 дня.

## Порядок и взаимозависимости

```
Slice 1 ─→ Slice 2 ─→ Slice 3 ─→ Slice 4 ─┬→ Slice 5
                                          ├→ Slice 6
                                          └→ Slice 7 (опционально)
```

Рекомендуемый порядок: **1 → 2 → 3 → 4 → 6 → 5 → 7**. Slice 6 (Inbox) делается **до** Slice 5 (address mgmt UI), потому что на старте можно добавить адрес и через curl/SQL — главная ценность вся в Inbox-UX.

## Что вне scope этапа 1

- ❌ Парсинг DEX traces (STON.fi/DeDust). Пользователь склеивает свопы вручную в Inbox.
- ❌ Авто-discovery новых Jetton-ов. Неизвестный jetton master → попадает в Inbox с пометкой, пользователь либо привязывает к существующему `crypto_assets`, либо создаёт новый.
- ❌ Real-time подписка / webhooks. Только pull по запросу или cron.
- ❌ Другие сети (ETH, BTC, Solana). Поля `network_code` оставлены, но логика только TON.
- ❌ Реконсиляция с уже введёнными вручную транзакциями. Решается через `imported_from` при добавлении адреса (всё, что старее этой даты, не тянем).
- ❌ Переоценка DeFi-позиций изнутри (накопленный yield, rewards). Остаётся ручной апдейт через `set__update_crypto_protocol_position`.
- ❌ Авто-учёт gas. На TON газ копейки, в этап 1 не отдельной статьёй.

## Главные риски

1. **Cost basis для transfer_in от внешнего peer-адреса.** В UX закладываем `peer_external` со cost basis = live × qty. Это может занижать realized P&L при последующем выводе (пользователь как бы «получил по рынку»), но даёт честную картину при условии, что человек явно подтвердил выбор. Альтернатива (cost basis = 0 как income) хуже — занижает текущий капитал.
2. **Дубли при mixed-mode.** Если пользователь продолжит вводить tx руками после подключения адреса — будут дубли. Mitigation: при добавлении адреса дефолт `imported_from = today`. Если хочется backfill — отдельная кнопка с предупреждением.
3. **DeFi close ambiguity.** Если на одном счёте две открытые позиции в одном протоколе — close-tx не классифицируется автоматом, fallback в Inbox с выбором позиции.
4. **TonAPI rate limits.** Для одного юзера на бесплатном тире — не должно быть проблемой, но логику с backoff и кешем сырых событий надо иметь сразу (Slice 2).
5. **Unknown jetton-ы.** Спам-токены могут засорять Inbox. Mitigation: отдельный фильтр `is_likely_spam` (без верификации в jetton-метаданных + нулевая live price = скрыть, но оставить доступным).

## Smoke-тест после полной реализации

1. Добавить TON-адрес, `imported_from = today − 30d`, sync. В Inbox появилось N событий.
2. Resolve transfer_in от bank-адреса с выбором лота → видим `transfer_in` в asset detail с правильным cost basis. Чекбокс «запомнить как bank_in» включён → второй такой tx уже не падает в Inbox с лот-выбором заново.
3. Send to Tonstakers → авто-создалась DeFi позиция staking (без участия пользователя).
4. Receive from Tonstakers → DeFi позиция авто-закрылась, principal вернулся в asset с `source_kind='defi_return'`.
5. TON out на STON.fi router + USDT in от STON.fi pool. В Inbox два события — выделили оба, склеили в swap. На фронте отрисовался обычный swap event.
6. Internal transfer между двумя своими адресами (один — в этом же account, другой — в другом). Первый случай скрыт автоматом, второй создал парный `transfer_between_investment_accounts`.
7. Получить 1 TON от знакомого → resolve как `peer_in`, cost basis = live. Запомнить адрес. Следующий перевод от него уйдёт в Inbox с pre-selected `peer_in`.
8. Удалить адрес — старые события остаются, новые не тянутся.
