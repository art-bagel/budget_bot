CREATE SCHEMA IF NOT EXISTS budgeting;

-- Сессии клиентов. Хранится только sha256 от токена: утечка дампа базы
-- не дает возможности войти. Сам токен живет в Keychain на устройстве.
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
