CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.users (
    id bigint PRIMARY KEY,
    base_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    username varchar(100),
    first_name varchar(100),
    last_name varchar(100),
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);
