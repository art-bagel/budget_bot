CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.users (
    id bigint PRIMARY KEY,
    base_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    username varchar(100),
    first_name varchar(100),
    last_name varchar(100),
    hints_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower
    ON budgeting.users (lower(username))
    WHERE username IS NOT NULL;
