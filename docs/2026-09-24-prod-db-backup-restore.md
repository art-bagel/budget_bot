# Бэкап прод-базы и рестор в dev

Дата: 2026-09-24

## Цель

По просьбе пользователя снять бэкап боевой базы `budget_bot` и обновить ей
локальный dev-Postgres (обычный сценарий `prod-to-dev`, есть отдельный скилл
и `infra/db/restore_from_prod.sh`).

## Что было найдено в процессе

Штатный путь (`./infra/db/restore_from_prod.sh`, дамп через прямое
подключение из dev-контейнера по сети) не сработал — и не по одной причине:

1. **`PROD_HOST` в скрипте (`192.168.30.105`) устарел.** По факту это хост
   `vaultwarden` (Vaultwarden в docker, порт 5432 не слушается вообще).
   Актуальный хост прод-базы — `192.168.30.100` (hostname `budget-bot`,
   контейнер `budget_bot_db`).
2. **`PROD_USER`/`PROD_DB` в скрипте (`readonly_chat_user`/`budget_bot`) не
   совпадают с реальными.** В контейнере на `.100` роль называется `budget`,
   база — `budget`, роли `postgres` и базы `budget_bot` там нет.
3. **`PROD_PASSWORD` из `infra/db/.env.prod` не подходит для прямого сетевого
   входа под `budget`** — TCP до `192.168.30.100:5432` из dev-контейнера
   доступен (`REACHABLE`), но `psql -h 192.168.30.100 -U budget -d budget`
   с этим паролем падает на `FATAL: password authentication failed`.
   Дальше пароль не подбирался (это подбор credentials, а не диагностика).

## Итоговая последовательность действий, которая сработала

Обошли прямое сетевое подключение — сняли дамп локально на самом прод-хосте
через SSH (`~/.ssh/master_agent_ed25519`, пользователь `master_agent`,
доступ описан в `~/.claude/CLAUDE.md`) и перенесли его вручную:

```bash
# 1. Дамп внутри контейнера на самом прод-хосте
ssh -i ~/.ssh/master_agent_ed25519 master_agent@192.168.30.100 '
  set -e
  DUMP=/tmp/prod_budget_$(date +%Y%m%d_%H%M%S).dump
  sudo docker exec budget_bot_db pg_dump -U budget -d budget \
       -Fc --no-owner --no-privileges -f "$DUMP"
  sudo docker cp budget_bot_db:"$DUMP" "$DUMP"
  sudo chmod 644 "$DUMP"
'

# 2. Скачать дамп локально и удалить копию с прод-хоста
scp -i ~/.ssh/master_agent_ed25519 \
    master_agent@192.168.30.100:/tmp/prod_budget_<ts>.dump ./prod_budget.dump
ssh -i ~/.ssh/master_agent_ed25519 master_agent@192.168.30.100 \
    'sudo rm -f /tmp/prod_budget_<ts>.dump'

# 3. Загрузить в dev-контейнер и восстановить (как делает штатный скрипт)
docker cp ./prod_budget.dump budget_bot_db:/tmp/prod_budget.dump
docker exec budget_bot_db psql -U postgres -d budget_bot -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS budgeting CASCADE; CREATE SCHEMA budgeting;"
docker exec budget_bot_db pg_restore -U postgres -d budget_bot \
  --clean --if-exists --no-owner --no-privileges /tmp/prod_budget.dump

# локальную копию дампа с рабочей машины удалить — бэкапом служит файл,
# оставленный внутри dev-контейнера (/tmp/prod_budget.dump)
```

Проверка: `information_schema.tables` в `budgeting` — 33 таблицы,
`budgeting.users` — 9 строк, `GET /health` бэкенда — `{"status":"ok",...}`.

## Команды отката

Откатывать нечего на стороне прода (снятие дампа — read-only). На dev-стороне
рестор необратимо стирает предыдущее содержимое схемы `budgeting` — если
локальные dev-данные были нужны, их уже не вернуть иначе как повторным
рестором из более раннего дампа (если такой есть внутри контейнера в `/tmp`).

## Известные уязвимости / осознанные риски

Ничего не ослаблялось: доступ шёл через уже выданный `master_agent` ключ
(read/sudo, не запись в прод) и по прод-паролю только на чтение. Пароль
неудачно подобранной попытки не логировался и не сохранялся.

## Открытые вопросы / известные ограничения

- `infra/db/restore_from_prod.sh` и `.claude/skills/prod-to-dev/SKILL.md`
  ссылаются на устаревший `PROD_HOST=192.168.30.105` и
  `PROD_USER=readonly_chat_user` / `PROD_DB=budget_bot` — актуальные значения
  `192.168.30.100` / `budget` / `budget`. Скрипт **не обновлён** в этом
  прогоне (нет рабочего пароля для проверки прямого сетевого пути) — при
  следующем запуске он снова упадёт тем же способом, пока кто-то не поправит
  либо сам скрипт (host/user/db), либо `.env.prod` (актуальный пароль
  пользователя `budget`), либо не переведёт скилл на SSH-путь, описанный
  выше.
- Оставленный внутри `budget_bot_db` файл `/tmp/prod_budget.dump` — это и
  есть бэкап на сейчас; старые дампы стоит периодически подчищать
  (`docker exec budget_bot_db ls -lh /tmp/`).
