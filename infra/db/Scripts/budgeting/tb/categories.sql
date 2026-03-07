CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.categories (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES budgeting.users(id),
    name varchar(100) NOT NULL,
    kind varchar(20) NOT NULL CHECK (kind IN ('regular', 'group', 'system')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT uq_categories_user_name UNIQUE (user_id, name)
);
