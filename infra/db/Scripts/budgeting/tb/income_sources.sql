CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.income_sources (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES budgeting.users(id),
    name varchar(100) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT uq_income_sources_user_name UNIQUE (user_id, name)
);
