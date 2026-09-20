CREATE SCHEMA IF NOT EXISTS budgeting;

-- Подключения к внешним брокерам и биржам (Тинькофф и т.п.).
-- Перенесено из миграции 018: таблица создавалась только там, поэтому
-- свежая установка из tb/ оставалась без неё, и функции, которые её
-- читают, не создавались вовсе.
--
-- credentials хранит токен в зашифрованном виде — см. storage/secretbox.py.
CREATE TABLE IF NOT EXISTS budgeting.external_connections (
    id                    bigserial PRIMARY KEY,
    owner_type            varchar(20) NOT NULL,
    owner_user_id         bigint REFERENCES budgeting.users(id),
    owner_family_id       bigint REFERENCES budgeting.families(id),
    provider              varchar(30) NOT NULL,        -- 'tinkoff', 'interactive_brokers', ...
    provider_account_id   text        NOT NULL,        -- идентификатор счёта на стороне брокера
    linked_account_id     bigint REFERENCES budgeting.bank_accounts(id),
    credentials           jsonb       NOT NULL DEFAULT '{}',
    settings              jsonb       NOT NULL DEFAULT '{}',  -- {"sync_from": "2024-01-01"}
    last_synced_at        timestamptz,
    is_active             boolean     NOT NULL DEFAULT true,
    created_at            timestamptz          DEFAULT now(),
    CONSTRAINT chk_ext_conn_owner CHECK (
        (owner_type = 'user'   AND owner_user_id   IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_family_id IS NOT NULL AND owner_user_id   IS NULL)
    ),
    CONSTRAINT uq_ext_conn UNIQUE (provider, provider_account_id, owner_user_id, owner_family_id)
);
