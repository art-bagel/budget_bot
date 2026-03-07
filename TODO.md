# TODO: Замечания к схеме и бизнес-логике

## CRITICAL

- [ ] **Race condition в FX-лотах** (`put__record_expense.sql`)
  Два параллельных расхода могут потребить один и тот же лот — нет `SELECT ... FOR UPDATE`.
  Решение: добавить `FOR UPDATE` в цикл выборки лотов.

- [ ] **Уникальность is_primary у банковских счетов** (`bank_accounts.sql`)
  Несколько счетов одного пользователя могут быть `is_primary = true`.
  Решение: добавить `UNIQUE (user_id) WHERE is_primary = true`.

- [ ] **Циклические группы** (`group_members.sql`)
  Группа A содержит B, группа B содержит A — ничего не мешает.
  Решение: добавить триггер или проверку на циклы при вставке.

- [ ] **Округление при распределении по группе** (`put__allocate_group_budget.sql`)
  При распределении на N участников возможна потеря до N-1 копеек из-за повторных округлений.
  Текущий алгоритм с "остаток последнему" работает, но может ломаться при floating-point ошибках в shares.

- [ ] **Deadlock-риск** (`put__record_expense.sql`)
  Множественные UPDATE/INSERT без единого порядка блокировок.
  Решение: всегда обновлять в порядке ID + использовать `FOR UPDATE`.

## MAJOR

- [ ] **Бюджет не проверяет валюту** (`budget_entries.sql`)
  Позволяет любую валюту, хотя по модели должна быть только базовая валюта пользователя.
  Решение: добавить CHECK constraint через триггер.

- [ ] **FX Result может отсутствовать** (`put__exchange_currency.sql`)
  Функция упадёт, если системная категория FX Result не была создана при регистрации.
  Решение: гарантировать создание при регистрации или автосоздание.

- [ ] **Неполная валидация reversal не-базовой валюты** (`put__reverse_operation.sql`)
  Нет проверки что лот не был частично потреблён другой операцией перед отменой.
  Решение: добавить явную проверку `amount_remaining = amount_initial`.

- [ ] **Нет индекса на (user_id, kind)** (`categories.sql`)
  Все функции фильтруют по этим полям, но индекса нет.
  Решение: `CREATE INDEX idx_categories_user_kind ON categories(user_id, kind);`

## MEDIUM

- [ ] **Несоответствие DBML и SQL**
  - `transfer` есть в DBML, но отсутствует в `operations.type`.
  - `is_primary` default: DBML — `true`, SQL — `false`.
  - CURRENCY_MODEL не содержит kind='system' для категорий.
  Решение: привести DBML в соответствие с SQL или наоборот.

- [ ] **Нет created_at на транзакционных таблицах**
  Отсутствует на: `bank_entries`, `budget_entries`, `lot_consumptions`, `group_members`.
  Решение: добавить `created_at timestamptz DEFAULT current_timestamp`.

- [ ] **Нет валидации FX-курсов** (`put__record_fx_rate_snapshot.sql`)
  Можно записать rate=0 или отрицательный, timestamp из будущего.
  Решение: добавить CHECK на разумные границы rate и timestamp.

- [ ] **Разная точность numeric**
  `bank_entries` — `numeric(20,8)`, `budget_entries` — `numeric(20,2)`.
  При расчётах в `put__record_expense` деление может терять точность.
  Решение: явно приводить типы перед округлением.

- [ ] **Нет CHECK на fx_lots**
  Ничто не мешает `amount_remaining > amount_initial` и `cost_base_remaining > cost_base_initial`.
  Решение: добавить `CHECK (amount_remaining <= amount_initial)` и аналогично для cost.

- [ ] **Убрать категорию доход из визуального интерфейса** 

## LOW

- [ ] **Несогласованные сообщения об ошибках** — разный формат RAISE EXCEPTION в функциях.
- [ ] **Нет ON DELETE политики** на FK `bank_entries → bank_accounts` (нет явного RESTRICT/CASCADE).
- [ ] **Нет документации по семантике category kind** — что можно делать с каждым типом.


сделать запреты в визуале на расход когда сумма расхода больше доступного остатка

сделать отображение доступного остатка при распределении

отображени остатка на дашборде для группу общей суммы всех категорий в группе