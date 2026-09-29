# Переименование монеты TON → GRAM

## Цель
Монета TON официально переименована в GRAM. Меняем только отображаемый символ монеты; сеть
(`network_code = 'ton'`) и провайдер счёта (`bank_accounts.provider_name = 'TON'`) остаются.

## Что сделано
- Миграция `infra/db/Scripts/budgeting/migrations/050_rename_ton_coin_to_gram.sql`:
  `crypto_assets.symbol`, `crypto_protocol_positions.asset_symbol` и metadata,
  `portfolio_positions.title` и metadata, `portfolio_events.metadata`.
  Проверена в транзакции с откатом, затем применена на dev через `run_migrations.sh`.
- `COINGECKO_IDS_BY_SYMBOL`: добавлен `GRAM` (id `the-open-network` не менялся), `TON` оставлен.
- Фронт: `GRAM` в `LOCAL_COIN_ICONS`; для нативной монеты сети TON подпись сети не дублируется.
- Токен `TON-SLP` (отдельный токен) не менялся.

## Откат
`UPDATE` в обратную сторону теми же условиями (`'GRAM'` → `'TON'`, только `network_code='ton'`,
`contract_address=''` для `crypto_assets`).

## Известные ограничения
- Журнал источников (`crypto_source_events`, `crypto_source_mutations`) — история, не переписывался:
  в нём остаётся `"TON"`. Повторный replay из журнала вернёт символ TON, после него миграцию
  надо накатить снова.
- Исторические import-скрипты (`scripts/crypto`, `import_*`) содержат `'TON'`; не менялись.
- Перед прод-накаткой нужен свежий дамп по порядку из заметки о выпуске.
