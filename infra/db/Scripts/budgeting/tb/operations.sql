CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.operations (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES budgeting.users(id),
    income_source_id bigint REFERENCES budgeting.income_sources(id),
    type varchar(30) NOT NULL CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'reversal')),
    reversal_of_operation_id bigint REFERENCES budgeting.operations(id),
    comment text,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);
