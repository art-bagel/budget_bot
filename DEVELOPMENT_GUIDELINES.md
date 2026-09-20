# Рекомендации по разработке Budget Bot

Документ описывает правила и паттерны, которых следует придерживаться при доработке проекта, чтобы избежать повторения ранее найденных ошибок.

---

## 1. SQL-функции: блокировки и конкурентность

### Правило: всегда блокировать строку баланса перед чтением

Любая SQL-функция, которая читает баланс и затем принимает решение (достаточно ли средств), **обязана** сначала заблокировать строку через `FOR UPDATE`.

**Правильно:**
```sql
-- 1. Блокируем строку
PERFORM 1 FROM current_bank_balances
WHERE bank_account_id = _account_id AND currency_code = _currency_code
FOR UPDATE;

-- 2. Читаем заблокированное значение
SELECT COALESCE(amount, 0) INTO _balance
FROM current_bank_balances
WHERE bank_account_id = _account_id AND currency_code = _currency_code;

-- 3. Проверяем
IF _balance < _amount THEN
    RAISE EXCEPTION '...';
END IF;
```

**Неправильно:**
```sql
-- Чтение без блокировки — race condition!
SELECT COALESCE(amount, 0) INTO _balance
FROM current_bank_balances
WHERE bank_account_id = _account_id AND currency_code = _currency_code;

IF _balance < _amount THEN ...
```

### Правило: единый порядок блокировок

Всегда блокировать ресурсы в одном порядке, чтобы избежать deadlock:
1. `current_bank_balances` (по возрастанию `bank_account_id`)
2. `current_budget_balances` (по возрастанию `category_id`)

Если нужно заблокировать два банковских счёта — всегда сначала тот, у которого меньший `id`.

---

## 2. SQL-функции: owner_type в операциях

### Правило: owner берётся из данных, а не хардкодится

При создании записи в `operations` поля `owner_type`, `owner_user_id`, `owner_family_id` **должны** отражать реального владельца ресурса.

**Правильно:**
```sql
INSERT INTO operations (actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment)
VALUES (_user_id, _from_owner_type, _from_owner_user_id, _from_owner_family_id, 'account_transfer', _comment);
```

**Неправильно:**
```sql
-- Хардкод 'user' ломает семейные операции!
VALUES (_user_id, 'user', _user_id, NULL, 'account_transfer', _comment);
```

---

## 3. SQL-функции: логика реверса

### Правило: проверяем баланс на стороне, которая будет уменьшена

При реверсе операции нужно проверить, хватит ли баланса для обратной записи:
- Если оригинальная запись **добавляла** (amount > 0), реверс будет **вычитать** → нужна проверка
- Если оригинальная запись **вычитала** (amount < 0), реверс будет **добавлять** → проверка не нужна

```sql
-- Если оригинал ДОБАВЛЯЛ средства, реверс их заберёт — проверяем баланс
IF _entry.amount > 0 THEN
    -- проверить, что текущий баланс >= _entry.amount
END IF;
```

---

## 4. Python API: валидация входных данных

### Правило: все числовые суммы проверять на > 0

Каждая Pydantic-модель с полем `amount` (или аналогом) **обязана** иметь `field_validator`:

```python
from pydantic import BaseModel, field_validator

class MyRequest(BaseModel):
    amount: float

    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Сумма должна быть положительной')
        return v
```

### Правило: строковые поля проверять на пустоту

Любое строковое поле, которое является "именем" или "названием", должно иметь проверку:

```python
@field_validator('name')
@classmethod
def name_must_not_be_empty(cls, v: str) -> str:
    if not v or not v.strip():
        raise ValueError('Название не может быть пустым')
    return v.strip()
```

### Правило: currency_code — 3 буквы

```python
@field_validator('currency_code')
@classmethod
def currency_code_must_be_valid(cls, v: str) -> str:
    v = v.strip().upper()
    if len(v) != 3 or not v.isalpha():
        raise ValueError('Код валюты должен состоять из 3 букв')
    return v
```

### Правило: даты через типы Pydantic, не через ручной парсинг

```python
# Правильно — Pydantic сам валидирует и возвращает понятную ошибку
credit_started_at: Optional[date] = None

# Неправильно — ValueError без контекста при невалидной строке
credit_started_at: Optional[str] = None
# ... date.fromisoformat(body.credit_started_at) в обработчике
```

### Правило: enum-поля через Literal

```python
# Правильно
theme: Optional[Literal['light', 'dark', 'system']] = None

# Неправильно — принимает любую строку
theme: Optional[str] = None
```

---

## 5. Безопасность

### Правило: не возвращать сырые ошибки БД клиенту

Ошибки PostgreSQL могут содержать имена таблиц, constraint-ов, схемы. Возвращать клиенту только бизнес-ошибки из `RAISE EXCEPTION` (класс `RaiseError`):

```python
@app.exception_handler(asyncpg.PostgresError)
async def postgres_exception_handler(_request, exc):
    if isinstance(exc, asyncpg.RaiseError):
        return PlainTextResponse(str(exc), status_code=400)
    logger.error('Database error: %s', exc)
    return PlainTextResponse('Внутренняя ошибка сервера', status_code=500)
```

### Правило: dev-режим аутентификации защищён от продакшена

Fallback на `X-Telegram-User-Id` без подписи допустим **только** когда `TELEGRAM_BOT_TOKEN` не задан:

```python
if settings.telegram_bot_token:
    raise HTTPException(status_code=401, detail='Missing Telegram init data')
# Далее — dev-fallback
```

### Правило: CORS — минимальные разрешения

Указывать конкретные методы и заголовки, а не `'*'`:

```python
allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
allow_headers=['Content-Type', 'X-Telegram-Init-Data', 'X-Telegram-User-Id'],
```

---

## 6. Производительность

### Правило: избегать N+1 запросов

Если нужно получить данные для списка сущностей — делать это параллельно или одним запросом:

```python
# Правильно — параллельные запросы
tasks = {id: fetch(id) for id in ids}
results = await asyncio.gather(*tasks.values())
snapshots = dict(zip(tasks.keys(), results))

# Неправильно — последовательные запросы в цикле
for id in ids:
    snapshots[id] = await fetch(id)  # N запросов подряд
```

### Правило: списковые эндпоинты с пагинацией

Любой GET-эндпоинт, возвращающий список, должен поддерживать `limit` и `offset`:

```python
@router.get('/items')
async def get_items(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list:
    ...
```

---

## 7. Scheduled expenses и фоновые задачи

### Правило: scheduler должен быть идемпотентным

Рассчитывать на то, что одна и та же задача может быть запущена дважды. `put__advance_scheduled_expense` в блоке `finally` гарантирует сдвиг `next_run_at` даже при ошибке.

### Правило: при удалении ресурсов (dissolution, archive) проверять зависимые scheduled expenses

Перед удалением категории или роспуском семьи — деактивировать или уведомить о связанных scheduled expenses.

---

## 8. FX-лоты и округление

### Правило: при полном потреблении лота — брать остаток, а не пересчитывать

Если лот потребляется целиком, cost берётся из `cost_base_remaining`, а не вычисляется заново. Это предотвращает накопление ошибок округления:

```sql
IF _consume_amount = _lot.amount_remaining THEN
    _consume_cost := _lot.cost_base_remaining;  -- точное значение
ELSE
    _consume_cost := round(_lot.cost_base_remaining * _consume_amount / _lot.amount_remaining, 2);
END IF;
```

---

## 9. Схема БД: миграция и tb/ — оба места

### Правило: новый объект добавляется и в миграцию, и в `tb/`

Миграция обновляет уже существующие базы, `tb/` собирает свежие. Это две
разные задачи, и одна другую не заменяет.

Что бывает, когда забыли: `external_connections` полгода существовала только
в миграции 018, а `credit_payment_events` лежала в `tb/`, но не была вписана
в список `FILES` в `run_table_scripts.sh`. Свежая база собиралась неполной и
падала на первой же функции, которая их читает. Заметить это было неоткуда —
прод построили один раз давно, а dev восстанавливают из дампа прода.

Теперь CI собирает схему с нуля на каждый push, поэтому расхождение всплывает
сразу. Плюс `run_table_scripts.sh` падает, если файл положили в `tb/`, но не
вписали в `FILES` (порядок там значим из-за внешних ключей).

### Правило: миграция применяется ровно один раз и не переписывается

Файлы в `migrations/` учитываются в `budgeting.schema_migrations` по имени.
Уже применённый файл повторно не выполняется — значит, править его
бессмысленно: на существующих базах изменение не подхватится. Нужна новая
миграция.

По этой же причине миграцию нельзя переименовывать: для учёта это будет
другой файл, и он выполнится второй раз.

### Правило: функции не нуждаются в миграциях

Каждый файл в `func/` начинается с `DROP FUNCTION IF EXISTS`, и весь каталог
пересоздаётся на каждом прогоне. Менять функцию — значит просто
отредактировать её файл. Отдельная миграция нужна только если меняется
сигнатура и старую перегрузку надо снести явно.

---

## 10. Чеклист перед коммитом

- [ ] Все новые числовые поля в Request-моделях имеют валидатор `> 0`
- [ ] Все новые строковые поля-имена проверяются на пустоту
- [ ] Currency codes валидируются (3 буквы)
- [ ] SQL-функции с проверкой баланса используют `FOR UPDATE`
- [ ] Owner_type в INSERT INTO operations берётся из данных ресурса
- [ ] Ошибки БД не возвращаются клиенту в сыром виде
- [ ] Новые GET-эндпоинты поддерживают пагинацию
- [ ] Нет последовательных запросов в цикле (N+1)
- [ ] Даты в Request-моделях используют тип `date`, а не `str`
- [ ] Новая таблица/колонка добавлена и в миграцию, и в `tb/` (а файл `tb/` — в список `FILES`)
- [ ] Уже применённая миграция не переписывалась и не переименовывалась
