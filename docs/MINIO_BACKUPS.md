# Ежечасные бэкапы PostgreSQL в MinIO

Скрипт `scripts/backup-to-minio.sh` создаёт сжатый дамп PostgreSQL, проверяет его,
загружает в `s3.mrbagel.ru/budgetbackup/budget-bot/` и оставляет только три
последних дампа. Другие объекты бакета не затрагиваются.

## Настройка

1. Установите на сервере MinIO Client (`mc`). Docker Compose уже используется
   проектом. Инструкция: <https://min.io/docs/minio/linux/reference/minio-mc.html#install-mc>.
2. Добавьте GitHub Actions secrets:
   - `MINIO_ENDPOINT` = `https://s3.mrbagel.ru`;
   - `MINIO_BUCKET` = `budgetbackup`;
   - `MINIO_PREFIX` = `budget-bot`;
   - `MINIO_ACCESS_KEY` = `budgetbackup-user`;
   - `MINIO_SECRET_KEY` = secret key пользователя MinIO.
3. Запустите workflow **Deploy Budget Bot**. Он добавит настройки в `infra/.env`
   и установит cron на 15-й минуте каждого часа.

Все пять параметров MinIO берутся workflow из GitHub Secrets. Скрипт также имеет
значения по умолчанию для endpoint, бакета и префикса, чтобы ручной запуск был
удобнее. Число хранимых копий (`BACKUP_RETENTION=3`) задаётся workflow.

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
