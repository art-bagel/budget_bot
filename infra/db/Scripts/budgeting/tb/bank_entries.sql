CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.bank_entries (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    amount numeric(20, 8) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_entries_operation_id
    ON budgeting.bank_entries (operation_id);

CREATE INDEX IF NOT EXISTS idx_bank_entries_account_currency
    ON budgeting.bank_entries (bank_account_id, currency_code);
