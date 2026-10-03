# Валютный резерв в «Разном»: выкатка в production

03.10.2026. Ветка `codex/currency-reserve`, `main` перемотан fast-forward
`cdfcf05..03693e9` (без merge-коммита).

## Цель

Выпустить счёт «Валюта» (`investment_asset_type=currency`) внутри «Разного»
вместе с доработками дизайна портфеля.

## Что вошло

- `a017ffe` автоматический валютный резерв: миграция
  `054_currency_reserve_accounts.sql` (только расширяет
  `chk_bank_accounts_investment_asset_type` типом `currency`, данные не меняет),
  `get__portfolio_summary` с остатками по валютам и оценкой по курсу, API и UI.
- `0c37855` «Разное» = «Краудлендинг» и «Валюта» в выборе вида счёта.
- `1c6ce06` валюты показаны обычными строками позиций; кнопки «Перевести
  деньги» в портфеле нет — пополнение, как у всех счетов, переводом из банка.
- `0ef6dbc` круглые флаги валют (`flag-icons@7.5.0` через cdn.jsdelivr.net,
  тот же CDN, что у иконок монет; при ошибке — символ валюты).
- `03693e9` значок «монеты в руке» у позиций краудлендинга.

## Последовательность

1. Локально на ветке: `npm run build`, `npm run lint` (157 предупреждений, как
   прежде), `ruff check backend storage`, `unittest` test_fx_rates,
   test_bank_account_response, test_currency_reserve_api (10 OK),
   `node --test frontend/tests/currencyReserve.test.ts` (3 OK).
2. UI ветки проверен на dev (база `budget_dev_currency_20261003`) после
   пробного перевода EGP/EUR/TRY/USD на счёт «Валюта».
3. Пользователь сам выполнил
   `git push origin codex/currency-reserve:main` (агенту пуш в main запрещён
   правилами прав).
4. GitHub Actions run 37151933944: Verify Project (сборка, lint, схема с нуля,
   SQL-тесты, API-тесты) — success; Deploy To Server — success. Деплой снимает
   дамп в `/home/deploy/apps/budget_bot/pre-migrate-dumps/` перед миграциями.

## Проверка production (read-only, SSH master_agent@192.168.30.100)

- `/home/deploy/apps/budget_bot` HEAD = `03693e9`.
- `budget_bot_web`, `budget_bot_api` перезапущены, `budget_bot_db` healthy.
- Ограничение типа счёта содержит `currency` — миграция 054 применена.
- API `/health` 200, web `/` 200, `nginx -t` OK, ошибок в логах API за 5 минут
  после старта нет.
- Авторизованный UI production не проверялся; валютные счета на production
  не создавались.

## Откат

Код: вернуть `main` на `cdfcf05` и задеплоить (новые экраны исчезнут).
Схема: миграция 054 совместима с прежним кодом; откатывать её нужно, только
если счетов `currency` нет. Дамп перед миграцией — последний файл в
`pre-migrate-dumps/`; восстанавливать его поверх новых операций пользователей
нельзя.

## Открытые вопросы

- Локальный `main` в основной копии не перемотан до `origin/main`
  (`git branch -f main origin/main`) — агенту запрещено, сделать вручную.
- Этот отчёт закоммичен в `codex/currency-reserve` после выкатки и в `main`
  попадёт со следующим пушем.
- Курсы для оценки берутся по запросу (часовой кеш, ЦБ); фонового обновления
  нет — при недоступности источника показывается неполная оценка.
