CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.families (
    id bigserial PRIMARY KEY,
    name varchar(100) NOT NULL,
    base_currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);
