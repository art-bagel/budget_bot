CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.budget_entries (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    category_id bigint NOT NULL REFERENCES budgeting.categories(id),
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    amount numeric(20, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_entries_operation_id
    ON budgeting.budget_entries (operation_id);

CREATE INDEX IF NOT EXISTS idx_budget_entries_category_currency
    ON budgeting.budget_entries (category_id, currency_code);
