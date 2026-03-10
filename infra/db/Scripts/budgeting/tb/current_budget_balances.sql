CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.current_budget_balances (
    category_id bigint NOT NULL REFERENCES budgeting.categories(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    amount numeric(20, 2) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (category_id, currency_code)
);
