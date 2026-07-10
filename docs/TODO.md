# TODO — сводный чеклист доработок

Обновлено: 2026-07-06. Источники: [ISSUES.md](ISSUES.md) (баги/безопасность) и
[IMPROVEMENTS.md](IMPROVEMENTS.md) (улучшения). Порядок внутри блоков — рекомендуемый.

## 1. Безопасность и защита данных (из ISSUES.md — сделать первым) — ГОТОВО 2026-07-07

- [x] Шифровать токен Тинькофф в `external_connections.credentials` — Fernet в приложении (`storage/secretbox.py`), ключ `CREDENTIALS_ENCRYPTION_KEY`, legacy plaintext читается и перешифровывается при пересохранении
- [x] Fail-fast при пустом `TELEGRAM_BOT_TOKEN` в prod: `APP_ENV=production` требует токен и ключ шифрования на старте; dev-fallback `X-Telegram-User-Id` в production отклоняется всегда
- [x] Убрать дефолтный пароль `postgres` в docker-compose (`POSTGRES_PASSWORD` обязателен). Порт Postgres наружу оставлен намеренно — нужен внешний доступ к БД
- [x] Дополнить `.gitignore`: `node_modules/`, `.idea/`, `.DS_Store`, `*.tsbuildinfo`, `frontend/vite.config.js|d.ts`, `outputs/`, `skrin_shot/`, `.dbeaver/`, `*.xlsx`, `local-data/`
- [x] Вынести личные xlsx и скриншоты из корня репозитория → `local-data/` (в gitignore)
- [x] Двухшаговое подтверждение `DELETE /auth/account`: `POST /auth/account/delete-request` выдает подписанный токен (TTL 10 мин), DELETE требует его
- [x] Сократить TTL Telegram initData с 24 ч до 3 ч (дефолт 10800)

> Для деплоя нужно добавить GitHub-секрет `CREDENTIALS_ENCRYPTION_KEY`
> (сгенерировать: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).

## 2. Надёжность деплоя и данных (из ISSUES.md)

- [ ] Автоматическое применение миграций при деплое: таблица `schema_migrations` + идемпотентный runner (`migrations/*.sql` + пересоздание `func/`)
- [ ] Устранить дубли номеров миграций (два файла `019_*`, два `020_*`), зафиксировать правило нумерации
- [ ] Бэкапы Postgres: cron `pg_dump` → внешнее хранилище + периодическая проверка восстановления
- [ ] Advisory lock в scheduler + атомарное «взял в работу» (сдвиг `next_run_at` до исполнения)
- [ ] Пиновка версий в `backend/requirements.txt`; выровнять версию Python (образ 3.10 vs локальная 3.13)
- [ ] Понятные ошибки при отсутствии env-переменных в `config.py` (валидация на старте)

## 3. Корректность денежной логики (из ISSUES.md)

- [ ] Первые тесты: pytest + тестовая БД в docker; покрыть expense/income, transfer, exchange, reverse, FIFO-потребление, крипто-свапы
- [ ] `Decimal` вместо `float` по стеку (Pydantic-модели, ledger; на фронте — строки)
- [ ] `put__record_income_split`: не пропускать доли ≤ 0 молча — остаток к последней строке или исключение
- [ ] Скоуп `crypto_assets`: запретить перезапись `name`/`decimals`/`metadata` общих активов через публичный upsert
- [ ] Кэш цен крипты в БД (по образцу `fx_rate_snapshots`) вместо процессного dict; логировать ошибки CoinGecko; обновить маппинг MATIC → POL

## 4. Архитектурные улучшения (из IMPROVEMENTS.md)

- [ ] Идемпотентность операций: `client_op_id` (uuid) от клиента + уникальный индекс в `operations`
- [ ] Контракт ошибок: коды ошибок в plpgsql (`USING ERRCODE`/структурированные), `{code, params}` в API, словарь переводов на фронте вместо `text.includes(...)`
- [ ] Джоб сверки целостности: `SUM(bank_entries)` vs `current_*`-проекции, алерт при дрейфе
- [ ] Контрактные тесты SQL ↔ Pydantic (вызов всех `get__*` на тестовой БД, валидация моделями)
- [ ] Генерация TS-клиента из OpenAPI (`openapi-typescript`) вместо ручных `types.ts`/`api.ts`
- [ ] Наблюдаемость: request-id middleware, JSON-логи, Sentry (бэкенд + фронт)
- [ ] Вынести scheduler и Tinkoff-синк в отдельный воркер (arq) со статусами задач
- [ ] Индексная ревизия: `EXPLAIN ANALYZE` истории/аналитики, составные индексы `(owner, operated_at)`

## 5. Фронтенд — архитектура (из IMPROVEMENTS.md)

- [ ] TanStack Query: кэш, инвалидация по ключам, optimistic updates; убрать `refreshKeys`-ремаунты
- [ ] Распил `Portfolio.tsx` (~6000 строк) на фиче-модули (также `Credits.tsx`, `Operations.tsx`)
- [ ] `React.lazy` по страницам + code splitting (Portfolio не должен грузиться до дашборда)
- [ ] Лёгкий роутер (wouter) + deep links из бота через `start_param`
- [ ] Мгновенный старт: кэш последнего дашборда в `localStorage`/CloudStorage, показывать сразу с фоновым обновлением
- [ ] Виртуализация списка операций (`@tanstack/react-virtual`)

## 6. UX / UI (из IMPROVEMENTS.md)

- [ ] Дизайн-токены (CSS custom properties) одним PR — фундамент для портирования редизайна
- [ ] Портировать концепты из `ui-redesign-concepts/` поэкранно (Dashboard → Portfolio → Credits → Settings → Tinkoff sync)
- [ ] Быстрый ввод расхода: FAB на дашборде, предзаполнение последнего счёта/категории, «повторить операцию»
- [ ] Telegram-native: haptic feedback, `MainButton` в формах
- [ ] Пуши через бота: ошибка scheduled expense, приглашение в семью, месячный итог
- [ ] Дашборд-инсайт «можно тратить N/день до конца месяца»
- [ ] Тренд категории за 6 месяцев в деталке категории
- [ ] Экспорт операций в CSV/XLSX; импорт банковских выписок (CSV)
- [ ] Поиск и фильтры по истории операций

## 7. Продуктовые фичи (когда дойдут руки)

- [ ] Он-чейн импорт TON-кошелька (промоушен `ton-wallet-report/` в фичу крипто-модуля)
- [ ] Правила rollover по категориям (сгорает / переносится / к цели)
- [ ] Цели накоплений с прогрессом
- [ ] Роли в семье (владелец / участник / наблюдатель)

## Мелочи (из ISSUES.md, низкий приоритет)

- [ ] Пагинация списковых эндпоинтов, rate limiting
- [ ] Русифицировать/кодифицировать тексты `RAISE EXCEPTION`
- [ ] `/health` не отдавать схему и origins без авторизации
- [ ] Пул соединений: пересмотреть 4 пула × max_size=5
- [ ] Нормализованная таблица для fee/income портфеля вместо `metadata` jsonb
- [ ] Сузить широкие `except Exception` в `tinkoff_sync.py`
- [ ] Таймзона пользователя для scheduled expenses
