# Локальная дата и сумма регулярного расхода — 01.11.2026

Уровень **S**: два бага во фронтенде, без БД и без изменения денежной логики
сервера. Ветка `claude/local-date-schedule-amount`. Оба бага найдены по ходу
задач `2026-10-31-receipt-scan` и `2026-10-31-vnd-currency`.

## Что было

1. **Дата по UTC.** «Сегодня» в формах считалось как
   `new Date().toISOString().slice(0, 10)`, то есть по UTC. По Москве с 00:00
   до 03:00 это ещё вчера. Ночной расход, доход, событие портфеля, кредита или
   криптошторки по умолчанию уходил вчерашним днём. Тот же корень у границ
   периодов аналитики портфеля: `new Date(год, месяц, 1)` — локальная
   полночь, а `toISOString()` от неё — последний день прошлого месяца. Квартал
   «1 окт – 31 дек» уходил в запрос как «30 сен – 30 дек».
2. **Сумма регулярного расхода** (`sfAmount` в `CategoryActionSheet`) бралась
   как есть. Запятая с iOS-клавиатуры давала `NaN`, и сервер отклонял запрос, а
   «45.000» в донгах отправлялось как 45.

## Что сделано

1. `855616e`:
   - `isoDate(date = new Date())` в `utils/format.ts` — локальная дата
     `YYYY-MM-DD`;
   - на неё переведены `IncomeDialog`, `CategoryActionSheet` (расход),
     `PortfolioPositionDialog`, `Credits`, `Portfolio` (в том числе
     `dateFrom`/`dateTo` периода);
   - `todayIso()` в `utils/portfolioPosition.ts` (его используют 9
     криптошторок) считает так же, но своей копией: модуль грузит
     `node --test`, а он не находит относительный импорт без расширения.

   Тест `frontend/tests/isoDate.test.ts` фиксирует `TZ=Europe/Moscow`: 00:30
   1 ноября — это «2026-11-01», а начало и конец IV квартала —
   «2026-10-01»/«2026-12-31». Он падал до правки.
2. `f893306` — сумма регулярного расхода читается так же, как сумма расхода:
   `sanitizeDecimalInput(…, digits)`, `canonicalAmountInput` на blur и
   `readAmountField` при отправке с точностью валюты. E2e
   `browser-tests/scheduled-expense.spec.ts`: «150,5» → «150.5» → расписание на
   150.5 RUB → удаление. На старом коде поле оставляло «150,5».
3. Правило в `DEVELOPMENT_GUIDELINES.md` (§9a и чеклист), пункты в
   `docs/TODO.md` закрыты.

## Что не трогали

- `components/ExpenseDialog.tsx` — мёртвый код, на него нет ссылок.
- `localToday` в `utils/receiptScan.ts` уже считал локальную дату. Это ещё одна
  копия по той же причине с `node --test`.
- Формы инвестиций и кредитов с полным списком валют без `readAmountField`
  остаются по решению владельца (хвосты VND в `docs/TODO.md`).

## Откат

`git revert` коммитов задачи. Миграций нет.

## Деплой (01.11.2026)

- Аппрув владельца («Да, мержи»). `git push origin HEAD:main` без `--force`:
  `6ce3b9f..c1789e7`. Тем же пушем ушла запись о деплое правки позиций чека
  (`2b24381`).
- GitHub Actions, [run 41304716580](https://github.com/art-bagel/budget_bot/actions/runs/41304716580):
  «Verify Project» — success (5 мин), «Deploy To Server» — success (1 мин).
- Прод: `GET /health` — 200, отдаётся новый бандл `index-DubfRpNb.js`.
  Единственный `toISOString().slice(0, 10)` в нём — в `receiptDateForExpense`:
  там это намеренная арифметика над полуночью по UTC.
- Ветка `claude/local-date-schedule-amount` и worktree удалены, в GitHub
  ветка не пушилась.
