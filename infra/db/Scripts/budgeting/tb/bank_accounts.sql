CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.bank_accounts (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES budgeting.users(id),
    name varchar(100) NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT uq_bank_accounts_user_name UNIQUE (user_id, name)
);
