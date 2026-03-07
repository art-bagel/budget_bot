# Чеклист реализации бизнес-логики

## Условные обозначения
- [x] — реализовано (SQL-функция + Storage + Router)
- [~] — частично (SQL-функция + Storage, нет Router)
- [ ] — не реализовано

---

## 1. Контекст пользователя (Context)

- [x] `put__register_user_context` — регистрация пользователя, банковского счёта и системных категорий
  - Storage: `context.put__register_user_context`
  - Router: `POST /api/v1/auth/register`

- [x] `put__create_category` — создание категории
  - Storage: `context.put__create_category`
  - Router: `POST /api/v1/categories`

- [x] `set__replace_group_members` — замена состава группы
  - Storage: `context.set__replace_group_members`
  - Router: `PUT /api/v1/groups/members`

---

## 2. Отчёты (Reports)

- [x] `get__categories` — список категорий пользователя
  - Storage: `reports.get__categories`
  - Router: `GET /api/v1/categories`

- [x] `get__group_members` — участники группы с долями
  - Storage: `reports.get__group_members`
  - Router: `GET /api/v1/groups/{group_id}/members`

- [~] `get__bank_snapshot` — остатки банковского счёта по валютам
  - Storage: `reports.get__bank_snapshot`
  - Router: нет

- [~] `get__budget_snapshot` — бюджетные остатки по категориям
  - Storage: `reports.get__budget_snapshot`
  - Router: нет

- [~] `get__portfolio_valuation` — оценка портфеля в целевой валюте
  - Storage: `reports.get__portfolio_valuation`
  - Router: нет

---

## 3. Операции (Ledger)

- [~] `put__record_fx_rate_snapshot` — сохранение снимка валютного курса
  - Storage: `ledger.put__record_fx_rate_snapshot`
  - Router: нет

- [x] `put__record_income` — запись дохода (банк + бюджет)
  - Storage: `ledger.put__record_income`
  - Router: `POST /api/v1/operations/income`

- [~] `put__allocate_budget` — перемещение бюджета между категориями
  - Storage: `ledger.put__allocate_budget`
  - Router: нет

- [~] `put__allocate_group_budget` — распределение бюджета по группе
  - Storage: `ledger.put__allocate_group_budget`
  - Router: нет

- [~] `put__exchange_currency` — обмен валют внутри банка
  - Storage: `ledger.put__exchange_currency`
  - Router: нет

- [~] `put__record_expense` — запись расхода (банк + бюджет)
  - Storage: `ledger.put__record_expense`
  - Router: нет

- [~] `put__reverse_operation` — отмена (reversal) операции
  - Storage: `ledger.put__reverse_operation`
  - Router: нет
