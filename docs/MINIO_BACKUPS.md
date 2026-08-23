# Бэкапы PostgreSQL: два контура

`scripts/backup-to-minio.sh` создаёт сжатый дамп PostgreSQL, проверяет его
`pg_restore --list`, загружает в S3-хранилище и удаляет всё, кроме N последних
дампов **своего префикса**. Посторонние объекты не затрагиваются.

Контура два, и они не взаимозаменяемы:

| | назначение | хранилище | частота | глубина |
|---|---|---|---|---|
| `local` | быстро восстановиться | наш MinIO, `192.168.30.108:9000` | почасово, в `:15` | 48 копий (двое суток) |
| `remote` | пережить потерю сервера | Selectel | раз в сутки, в `03:40` | 14 копий |

Локальная копия лежит **на том же сервере**, что и сами сервисы, поэтому от
потери этого сервера спасает только `remote`. Уменьшать его частоту, ссылаясь
на то, что локальный контур и так есть, — значит не понять смысл разделения.

## Запуск руками

    ./scripts/backup-to-minio.sh          # remote, значение по умолчанию
    ./scripts/backup-to-minio.sh local
    ./scripts/backup-to-minio.sh remote

Назначение приходит первым аргументом. У каждого контура свой файл блокировки,
поэтому почасовой `local` и суточный `remote` не мешают друг другу в те сутки,
когда их расписания совпадают.

## Настройка

`mc` ставится Ansible-ролью `app-deploy-host` (репозиторий `home_network`),
руками его класть не нужно — именно из-за ручной установки бэкапы не приехали
при переезде на новый сервер.

GitHub Actions secrets, из которых workflow собирает `infra/.env`:

**remote (Selectel):** `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_PREFIX`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`.

**local (наш MinIO):** `LOCAL_S3_ENDPOINT`, `LOCAL_S3_BUCKET`,
`LOCAL_S3_ACCESS_KEY`, `LOCAL_S3_SECRET_KEY`. Необязательный
`LOCAL_S3_PREFIX` — если не задан, берётся `budget-bot`.

Глубину хранения задаёт workflow: `BACKUP_RETENTION=14` и
`LOCAL_BACKUP_RETENTION=48`.

У адреса и бакета **нет значений по умолчанию**: при неполном окружении скрипт
откажется стартовать, а не уедет молча не в то хранилище.

## Права MinIO

Пользователю `budgetbackup-user` нужна следующая политика (если весь бакет
предназначен только для этого проекта, условие по префиксу всё равно защищает от
случайного удаления посторонних объектов):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::budgetbackup"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::budgetbackup"],
      "Condition": {
        "StringLike": {"s3:prefix": ["budget-bot", "budget-bot/*"]}
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject", "s3:GetObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::budgetbackup/budget-bot/*"]
    }
  ]
}
```

## Проверка

После деплоя запустите на сервере из каталога проекта:

```bash
./scripts/backup-to-minio.sh
```

В бакете должен появиться объект вида
`budget-bot/budget_bot_20260720T120000Z.dump`. Лог cron хранится в
`backup-to-minio.log` в корне проекта.

Для проверки дампа скачайте его командой `mc cp` и выполните:

```bash
pg_restore --list budget_bot_YYYYMMDDTHHMMSSZ.dump
```

Периодически выполняйте тестовое восстановление в отдельную базу. Если в бакете
включено versioning, удалённые версии продолжают занимать место; для физического
хранения только трёх копий настройте lifecycle на удаление старых версий.
