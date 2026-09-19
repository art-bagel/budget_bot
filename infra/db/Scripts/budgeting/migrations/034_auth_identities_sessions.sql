-- 034: слой аутентификации — способы входа и сессии.
--
-- До этой миграции единственной identity был Telegram, и users.id физически
-- равен telegram user_id. Миграция не меняет это для существующих аккаунтов:
-- users.id остается внутренним идентификатором, а telegram-вход переезжает
-- в auth_identities как один из провайдеров.

SET search_path TO budgeting;

CREATE SEQUENCE IF NOT EXISTS budgeting.users_local_id_seq
    AS bigint
    START WITH 9007199254740992
    MINVALUE 9007199254740992;

ALTER TABLE budgeting.users
    ALTER COLUMN id SET DEFAULT nextval('budgeting.users_local_id_seq');

CREATE TABLE IF NOT EXISTS budgeting.auth_identities (
    provider        varchar(20)  NOT NULL,
    provider_uid    varchar(200) NOT NULL,
    user_id         bigint       NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    secret          text,
    failed_attempts smallint     NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (provider, provider_uid),
    CONSTRAINT ck_auth_identities_provider CHECK (provider IN ('telegram', 'password'))
);

CREATE INDEX IF NOT EXISTS ix_auth_identities_user_id
    ON budgeting.auth_identities (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_user_provider
    ON budgeting.auth_identities (user_id, provider);

CREATE TABLE IF NOT EXISTS budgeting.sessions (
    token_hash   bytea       PRIMARY KEY,
    user_id      bigint      NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    device       varchar(100),
    created_at   timestamptz NOT NULL DEFAULT current_timestamp,
    last_seen_at timestamptz NOT NULL DEFAULT current_timestamp,
    expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sessions_user_id
    ON budgeting.sessions (user_id);

CREATE INDEX IF NOT EXISTS ix_sessions_expires_at
    ON budgeting.sessions (expires_at);

-- Перенос существующих пользователей: сейчас users.id и есть telegram id.
INSERT INTO budgeting.auth_identities (provider, provider_uid, user_id, created_at)
SELECT 'telegram', u.id::text, u.id, u.created_at
FROM budgeting.users u
ON CONFLICT (provider, provider_uid) DO NOTHING;
