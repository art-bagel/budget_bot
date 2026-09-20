CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.users (
    id bigint PRIMARY KEY,
    base_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    username varchar(100),
    first_name varchar(100),
    last_name varchar(100),
    hints_enabled boolean NOT NULL DEFAULT true,
    -- Перенесено из миграции 002: в tb/ колонку забыли, и свежая
    -- установка падала на get__user_context.
    theme varchar(10) NOT NULL DEFAULT 'system'
        CHECK (theme IN ('light', 'dark', 'system')),
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower
    ON budgeting.users (lower(username))
    WHERE username IS NOT NULL;

-- Идентификаторы пользователей, зарегистрированных не через Telegram.
-- Telegram-id по документации укладываются в 52 бита (< 2^52), поэтому
-- старт с 2^53 исключает коллизию навсегда и остается далеко внутри bigint.
CREATE SEQUENCE IF NOT EXISTS budgeting.users_local_id_seq
    AS bigint
    START WITH 9007199254740992
    MINVALUE 9007199254740992;

ALTER TABLE budgeting.users
    ALTER COLUMN id SET DEFAULT nextval('budgeting.users_local_id_seq');
