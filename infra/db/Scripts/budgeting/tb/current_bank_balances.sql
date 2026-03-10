CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.current_bank_balances (
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    amount numeric(20, 8) NOT NULL DEFAULT 0,
    historical_cost_in_base numeric(20, 2) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (bank_account_id, currency_code)
);
