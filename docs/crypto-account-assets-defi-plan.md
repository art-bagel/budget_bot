# Crypto в портфеле — спецификация

> Полная замена прошлой редакции. Модель упрощена: cost basis крипты живёт в банке, портфель работает по рыночной цене и хранит историю входов/выходов как ленту событий.

## Принципы

1. **Cost basis source-of-truth — банк.** При вводе крипты в портфель банковская cost basis запоминается snapshot-ом в metadata входного события. Дальше актив в портфеле живёт по рыночной цене и текущая стоимость = `qty × live_price`.
2. **Одна `portfolio_positions` строка на (счёт, crypto_asset).** Уникальный индекс из миграции 029 защищает.
3. **Все entry-события несут `entry_value_in_base`** — сколько ₽ «зашло» вместе с активом. Это и есть «лот» в логическом смысле, без отдельной таблицы.
4. **Все exit-события несут `value_in_base`** — рыночная стоимость на момент выхода.
5. **Realized P&L = weighted-average на лету.** Никаких FIFO-конструкций.
6. **DeFi не создаёт деньги.** При открытии: из актива уходит `consumed_cost`, попадает в DeFi. При закрытии: возвращается принципалом + rewards с нулевой стоимостью.
7. **Swap в новый актив создаёт позицию на лету.** Бэкенд уже умеет (`put__swap_crypto_investment_asset.sql`).

## Модель данных

### Что остаётся

| Таблица | Назначение |
|---|---|
| `portfolio_positions` | одна строка на (account, crypto_asset). `amount_in_currency = 0` всегда |
| `portfolio_events` | лента всех движений: open / top_up / partial_close / close / income / fee / adjustment / transfer_in / transfer_out / swap_in / swap_out |
| `crypto_protocol_positions` | DeFi-позиция (single-asset для этапа 1) |
| `crypto_assets` | справочник |
| `operations` | корневая запись бизнес-операций (общий `operation_id` для парных событий) |

### Что добавляется

- В `portfolio_events.metadata` стандартизуются поля:
  - `entry_value_in_base: number` — для entry-событий (`transfer_in`, `swap_in`, `top_up`, `income`)
  - `value_in_base: number` — для exit-событий (`transfer_out`, `swap_out`, `partial_close`, `close`)
  - `source_kind: 'bank' | 'swap' | 'defi_return' | 'cross_account' | 'income'` — для entry
- Read-side SQL функции (см. API)

### Что НЕ добавляется (этап 1)

- ❌ `crypto_position_lots` — не нужно
- ❌ `crypto_protocol_position_legs` — отдельный этап (multi-asset LP)
- ❌ Отдельный `crypto_realized_pnl` — считается на лету в read-model

## Cost basis flow

### Entry-события

| Тип | Источник | `entry_value_in_base` | `source_kind` |
|---|---|---|---|
| `transfer_in` | bank → portfolio | snapshot банковского cost basis на момент перевода | `bank` |
| `swap_in` | другой crypto актив (тот же или другой счёт) | live × qty (рыночная FROM на момент свопа) | `swap` |
| `transfer_in` | другой investment account | weighted-avg consumed_cost из source-позиции | `cross_account` |
| `transfer_in` | возврат principal из DeFi | `crypto_protocol_position.cost_basis_carried` × proportion | `defi_return` |
| `income` | DeFi rewards / airdrop / other | 0 (по умолчанию) | `income` |

### Exit-события

| Тип | Назначение | `value_in_base` |
|---|---|---|
| `transfer_out` | portfolio → bank | live × qty |
| `transfer_out` | portfolio → DeFi (заморозка) | weighted-avg consumed_cost (попадает в `cost_basis_carried` DeFi) |
| `transfer_out` | portfolio → другой investment account | weighted-avg consumed_cost |
| `swap_out` | swap внутри портфеля | live × qty (рыночная FROM) |

### Read-side агрегация (одна позиция, один актив)

```
qty_now            = portfolio_positions.quantity
total_entry_value  = SUM(events.metadata.entry_value_in_base WHERE event in entry-types)
consumed_value     = SUM(events.metadata.value_in_base WHERE event in exit-types)
                       — ровно для тех квантов которые вышли
avg_cost_per_unit  = (total_entry_value − sum_of_consumed_cost_basis) / qty_now
current_value      = qty_now × live_price
unrealized_pnl     = current_value − (total_entry_value − sum_of_consumed_cost_basis)
realized_pnl       = SUM_per_exit (value_in_base − consumed_cost_basis)
```

`consumed_cost_basis` для каждого exit-события считается weighted-average:

```
consumed_cost_basis(exit_event) = qty_out × (entry_value_total_at_exit_time / qty_at_exit_time)
```

Это можно зафиксировать в самом event'е в момент создания (поле `metadata.consumed_cost_basis`) — тогда read будет тривиальным SUM.

## Сценарии (краткое описание; подробные walkthrough — в чате обсуждения)

### 1. bank → portfolio
Банк передаёт `crypto_asset_id`, `amount`, `cost_basis_in_base`. Портфель: создаёт/обновляет позицию, пишет `transfer_in` с `entry_value_in_base = cost_basis_in_base, source_kind='bank'`.

### 2. top-up того же актива
То же самое, добавляется новый event на ту же позицию. Уникальный индекс не даёт создать дубль.

### 3. swap в существующий актив (тот же счёт)
Парные `swap_out` / `swap_in` с общим `operation_id`. FROM: `value_in_base = live × qty_out`. TO: `entry_value_in_base = live × qty_out` (= то же значение, ноль арбитража внутри портфеля).

### 4. swap в новый актив
То же, но TO-позиция создаётся (бэкенд уже умеет). UI должен показывать ВСЕ доступные `crypto_assets` в picker'е TO, не только существующие на счёте.

### 5. swap в актив на другом счёте
Бэкенд принимает `target_investment_account_id`. Поведение идентично п.4, только TO-позиция создаётся/находится на другом счёте.

### 6. transfer между investment accounts (без свопа)
Парные `transfer_out` / `transfer_in` с общим `operation_id`. Cost basis переносится: `value_in_base = entry_value_in_base = consumed_cost_basis source-позиции`.

### 7. DeFi · open
- На portfolio position FROM: `transfer_out` с `value_in_base = consumed_cost_basis`
- Создаётся `crypto_protocol_position` с `cost_basis_carried = consumed_cost_basis`, `source_position_id`
- Поддерживается single-asset для этапа 1

### 8. DeFi · update
Ручной апдейт: `current_quantity`, `current_value_in_base`, `rewards_unclaimed_in_base`, `comment`. Без событий portfolio (DeFi-позиция отдельная сущность).

### 9. DeFi · close
- DeFi → `status=closed`, `withdrawn_at`, `return_value_in_base`
- На portfolio position TO (та же или новая): `transfer_in` принципала с `entry_value_in_base = cost_basis_carried × (returned_principal / original_principal)`, `source_kind='defi_return'`
- Если есть rewards: дополнительный `income` event с `entry_value_in_base = 0`
- Если returned < principal: разница закрывается как loss (специальный `adjustment` или просто меньше `entry_value`)

### 10. portfolio → bank
- Portfolio: `transfer_out` с `value_in_base = live × qty`, `metadata.consumed_cost_basis` фиксируется
- Банк: создаёт новый crypto lot с `cost_basis = value_in_base` (рыночная)
- realized для этого events = `value_in_base − consumed_cost_basis`

### 11. income (rewards вне DeFi, airdrop)
Просто `income` event на нужной позиции с `entry_value_in_base = 0` (по умолчанию).

## API

### Новые endpoints

```
GET /api/v1/portfolio/crypto/accounts/{account_id}/assets
→ List[CryptoAccountAssetSummary]
```

```python
class CryptoAccountAssetSummary(BaseModel):
    crypto_asset_id: int
    symbol: str
    name: str
    network_code: str
    quantity: float
    total_entry_value_in_base: float
    avg_cost_per_unit: float
    live_price: Optional[float]
    current_value_in_base: Optional[float]
    unrealized_pnl_in_base: Optional[float]
    unrealized_pnl_percent: Optional[float]
    realized_pnl_lifetime_in_base: float
    last_event_at: Optional[str]
```

```
GET /api/v1/portfolio/crypto/accounts/{account_id}/assets/{crypto_asset_id}
→ CryptoAccountAssetDetail (extends Summary)
   + entries: List[CryptoAssetEntryEvent]
```

```python
class CryptoAssetEntryEvent(BaseModel):
    event_id: int
    event_type: Literal[
      'transfer_in', 'swap_in', 'income',
      'transfer_out', 'swap_out',
    ]
    event_at: date
    quantity: float
    entry_value_in_base: Optional[float]      # для entry-типов
    value_in_base: Optional[float]            # для exit-типов
    consumed_cost_basis: Optional[float]      # для exit-типов
    realized_in_base: Optional[float]         # для exit-типов
    source_kind: Optional[str]
    operation_id: Optional[int]
    counterparty: Optional[str]               # "Tinkoff Cash", "USDT (тот же счёт)", "TON Stake DeFi"
    comment: Optional[str]
```

### Аудит существующих PUT-функций (Slice 1)

Каждая должна писать стандартные поля в metadata events. Проверить и при необходимости дописать:

| Функция | Что должно быть |
|---|---|
| `put__transfer_crypto_to_investment` | `transfer_in.metadata.entry_value_in_base`, `source_kind='bank'` |
| `put__transfer_crypto_from_investment` | `transfer_out.metadata.value_in_base`, `consumed_cost_basis` |
| `put__transfer_crypto_between_investment_accounts` | `transfer_out` (out-side: value+consumed), `transfer_in` (in-side: entry=consumed, source_kind='cross_account') |
| `put__swap_crypto_investment_asset` | `swap_out.metadata.value_in_base + consumed_cost_basis`, `swap_in.metadata.entry_value_in_base + source_kind='swap'` |
| `put__create_crypto_protocol_position` | `transfer_out.metadata.value_in_base = consumed_cost_basis`, `cost_basis_carried` в DeFi позиции |
| `set__close_crypto_protocol_position` | `transfer_in` принципала с carried cost, `income` для rewards с value=0 |

### Существующие endpoints (без изменений)

- `POST /crypto/transfer-to-investment`
- `POST /crypto/transfer-from-investment`
- `POST /crypto/transfer-between-investment-accounts`
- `POST /crypto/swap-investment-asset`
- `POST/PATCH/POST .../close` для protocol-positions

## Визуал (v2 design language: yellow accent, Onest)

### Экран счёта `Crypto Main`

```
══════════════════════════════════════════════════
  Crypto Main · Личный
  Сейчас 80 880 ₽   ↑ +13 120 ₽ (+19.4%)
──────────────────────────────────────────────────

  АКТИВЫ                                       3   [+]

  ●─ TON                              197
     57 130 ₽       ↑ +11 870 (+26.2%)
     avg 229.8 ₽/TON

  ●─ USDT                             250
     23 750 ₽       ↑ +1 250 (+5.6%)

  ●─ ETH                              0.05
     16 000 ₽       ↑ +1 000 (+6.7%)
──────────────────────────────────────────────────

  DEFI                                         1   [+]

  TON Stake · staking
  100 TON · 28 000 ₽ (+1.7% за 30 дней)
══════════════════════════════════════════════════
```

- Две явные секции «Активы» и «DeFi»
- Каждая со счётчиком и кнопкой `+` (добавить актив = перевод из банка / открыть DeFi)
- В строке актива — иконка-токен (CDN или хардкод), символ, qty, current value, P&L
- avg cost маленьким серым шрифтом
- Тап на строку → asset detail bottom-sheet
- Тап на DeFi → DeFi detail bottom-sheet

### Detail-sheet актива (bottom-sheet)

```
══════════════════════════════════════════════════
  ●─ TON · The Open Network                    [✕]

  Сейчас 197 TON
  57 130 ₽

  ┌─────────────┬─────────────┬─────────────┐
  │ Cost basis  │ Unrealized  │ Realized    │
  │ 45 260 ₽    │ +11 870 ₽   │ +3 010 ₽    │
  │ avg 229.8   │ +26.2%      │ lifetime    │
  └─────────────┴─────────────┴─────────────┘

  ИСТОРИЯ                                      7

  10 Jul   → −50 TON          14 500 ₽
           вывод в Tinkoff Cash       +3 010 real

  30 Jun   ← +2 TON                0 ₽
           награды из TON Stake

  30 Jun   ← +100 TON          23 160 ₽
           возврат из TON Stake

  30 May   → −100 TON          23 160 ₽
           заморозка в TON Stake

  20 May   ← +95 TON           23 750 ₽   250 ₽/T
           swap из USDT (тот же счёт)

  10 May   ← +50 TON           13 000 ₽   260 ₽/T
           перевод из Tinkoff Cash

   2 May   ← +100 TON          20 000 ₽   200 ₽/T
           перевод из Tinkoff Cash

  [ Перевести ]  [ Свопнуть ]  [ В DeFi ]
══════════════════════════════════════════════════
```

- Шапка как в существующих portfolio sheet (eyebrow + title + close)
- Три-колоночный stat-блок: Cost basis / Unrealized / Realized
- Лента истории — каждая строка: дата · направление (←/→) · qty · value · подпись (counterparty/source)
- Для exit-событий справа маленький badge `+X real` или `−X real`
- Внизу actions

### Detail-sheet DeFi

```
══════════════════════════════════════════════════
  ◆ TON Stake · staking                        [✕]
  Открыто 30 May · 100 TON

  Сейчас       28 500 ₽       (live + ручной апдейт)
  Cost basis   23 160 ₽       (заморожено из TON)
  Награды      +200 ₽         (нереализованные)

  PRINCIPAL
  100 TON

  REWARDS
  +0.7 TON unclaimed

  [ Обновить состав ]  [ Закрыть позицию ]
══════════════════════════════════════════════════
```

### Swap-форма (важно для slice 5)

В picker'е TO_asset показываются ВСЕ `crypto_assets` (с поиском), включая те, которых ещё нет на счёте. Бэкенд создаст новую позицию.

## Реализация · slices

### Slice 1 · Backend audit + standardize event metadata
**Цель:** все PUT-функции пишут стандартные поля в `portfolio_events.metadata`.
**Что:**
- Прочитать каждую PUT-функцию из таблицы выше
- Дописать `entry_value_in_base` / `value_in_base` / `consumed_cost_basis` / `source_kind` где не пишется
- Опционально: backfill старых events из `operations.metadata` (если реально, иначе пометить старое как `legacy_no_basis = true`)

**Риск:** низкий. SQL-функции независимы, изменения addable, ничего не ломает.

### Slice 2 · Read-side SQL + API
**Что:**
- `get__crypto_account_assets(account_id)` SQL функция
- `get__crypto_asset_detail(account_id, crypto_asset_id)` SQL функция
- Pydantic-модели + 2 новых GET endpoint в `routers/crypto.py`

**Зависит от:** Slice 1 (нужны корректные metadata)

### Slice 3 · Frontend asset detail sheet
**Что:**
- Новый компонент `CryptoAssetSheet.tsx` — bottom-sheet в v2-стиле
- Использует новые API
- Открывается по тапу на актив в списке

**Зависит от:** Slice 2

### Slice 4 · Account screen restructure
**Что:**
- В `Portfolio.tsx`: для crypto-счёта рендерить две секции «Активы» / «DeFi»
- Заменить client-side `aggregateCryptoPositionsByAsset` на API-ответ
- Удалить мёртвый код-путь (он же `grouped_position_ids`)
- Вынести крипто-actions (`CryptoSwap`, `CryptoTransfer`, `CryptoWithdraw`) в отдельные компоненты — снизить размер `Portfolio.tsx`

**Зависит от:** Slice 2

### Slice 5 · Swap form audit
**Что:**
- Проверить, что picker `to_crypto_asset_id` показывает все `crypto_assets`, не фильтруя по существующим
- При необходимости — поиск по символу

**Зависит от:** ничего

### Slice 6 (вне scope этапа 1) · DeFi multi-leg
**Что:**
- Таблица `crypto_protocol_position_legs` для multi-asset LP/vault
- UI-композиция нескольких активов
- Multi-asset open/close

## Порядок и взаимозависимости

```
Slice 1 ─→ Slice 2 ─→ Slice 3
                  └→ Slice 4
Slice 5 (независимо)
Slice 6 (после устаканивания)
```

Рекомендуемый порядок: **1 → 2 → 5 → 3 → 4**. Slice 5 (swap-form) делается между бэкенд- и фронт-частями, потому что он маленький и убирает баг прямо сейчас.

## Smoke-тест после полной реализации

1. купить 100 TON в bank (200 ₽/T) → перевести в Crypto Main → видим строку TON 100 / 20 000 ₽ / 0%
2. купить 50 TON ещё (260 ₽/T) → перевести → видим TON 150, avg 220
3. свопнуть 250 USDT → 95 TON → видим TON 245, avg 231.6, USDT 250
4. свопнуть 100 TON → 0.1 ETH → ETH 0.1 создалась автоматически
5. открыть TON Stake DeFi (100 TON) → секция DeFi, в Активах TON 145
6. закрыть DeFi (вернулось 102 TON) → TON 247, avg ~230, есть income event на 2 TON
7. вывести 50 TON в bank → TON 197, realized +X в asset detail
8. вывести 0.05 ETH в bank → ETH 0.05, новый ETH lot в банке
9. открыть detail TON — видим всю историю с counterparty + realized по exit-событиям
10. live-цены работают, P&L пересчитывается без перезагрузки
