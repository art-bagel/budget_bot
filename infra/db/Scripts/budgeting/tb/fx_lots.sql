CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.fx_lots (
    id bigserial PRIMARY KEY,
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    amount_initial numeric(20, 8) NOT NULL CHECK (amount_initial > 0),
    amount_remaining numeric(20, 8) NOT NULL CHECK (amount_remaining >= 0),
    buy_rate_in_base numeric(20, 8) NOT NULL CHECK (buy_rate_in_base > 0),
    cost_base_initial numeric(20, 2) NOT NULL CHECK (cost_base_initial >= 0),
    cost_base_remaining numeric(20, 2) NOT NULL CHECK (cost_base_remaining >= 0),
    opened_by_operation_id bigint NOT NULL REFERENCES budgeting.operations(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);
