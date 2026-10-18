# `/health` без конфигурации — 19.10.2026

Уровень **S** (безопасность, без денег и БД). Ветка `claude/health-minimal`.
Пункт P1 из `docs/TODO.md`.

## Цель

Публичный `GET /health` (без авторизации, проксируется nginx наружу) отдавал
`{"status", "schema", "frontend_origins"}` — имя схемы БД и список разрешённых
CORS-источников. Это лишние сведения о конфигурации для постороннего. Теперь
ответ — только `{"status": "ok"}`.

## Что нашли

- Потребители `/health` используют его только как «жив ли API»: `infra/nginx.conf`
  (проксирует наружу), `frontend/vite.config.ts` (прокси dev-сервера),
  `scripts/browser-tests.sh` (ожидание старта). Поля `schema` и
  `frontend_origins` нигде не читаются — ни в репозитории, ни в iOS-оболочке.
- Проверки на проде в отчётах деплоя смотрят только код ответа 200.

## Что сделано

1. Сначала тест: в `backend/tests/test_auth_api.py` шаг 0 — `/health` без
   заголовков отвечает 200 и ровно `{"status": "ok"}`. На старом коде упал:
   `{"status":"ok","schema":"budgeting","frontend_origins":[]}`.
2. `backend/app/main.py`: `healthcheck()` возвращает `{'status': 'ok'}`.
3. `docs/TODO.md`: пункт закрыт; пункт про Docker Hub отложен владельцем —
   проблема в роутере и доступности, решается в проекте сетевой
   инфраструктуры.

## Критерии приёмки и тесты

| # | Критерий | Тест |
|---|---|---|
| 1 | `/health` доступен без авторизации, код 200 | `test_auth_api.py`, шаг 0 |
| 2 | В ответе нет `schema` и `frontend_origins` — только `status` | там же, сравнение всего тела |
| 3 | Ожидание старта в браузерных тестах работает | `scripts/browser-tests.sh` в `check.sh` |

## Откат

`git revert` коммита. Миграций нет.

`scripts/check.sh` (полный) — GREEN, 19.10.2026.

## Деплой

19.10.2026 владелец дал аппрув. `2291a0d` запушен в `main` fast-forward
(`99d881e..2291a0d`, вместе с записью о деплое дизайн-справочника и правками
бэклога), [CI #407](https://github.com/art-bagel/budget_bot/actions/runs/39173152890):
`Verify Project` и `Deploy To Server` — успешно с первой попытки.

Проверено (readonly): контейнеры `budget_bot_api` и `budget_bot_web`
пересозданы в 22:43 UTC 18.10 по часам хоста; `/health` отвечает
`{"status":"ok"}` из контейнера API, через nginx и снаружи
(`budget.mrbagel.ru/health`); ошибок в логах API нет.
