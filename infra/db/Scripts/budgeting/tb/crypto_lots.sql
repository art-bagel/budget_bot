CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.crypto_lots (
    id bigserial PRIMARY KEY,
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id) ON DELETE CASCADE,
    crypto_asset_id bigint NOT NULL REFERENCES budgeting.crypto_assets(id),
    amount_initial numeric(30, 12) NOT NULL CHECK (amount_initial > 0),
    amount_remaining numeric(30, 12) NOT NULL CHECK (amount_remaining >= 0),
    cost_base_initial numeric(20, 2) NOT NULL CHECK (cost_base_initial >= 0),
    cost_base_remaining numeric(20, 2) NOT NULL CHECK (cost_base_remaining >= 0),
    opened_by_operation_id bigint NOT NULL REFERENCES budgeting.operations(id),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_crypto_lots_opened_by_operation_id
    ON budgeting.crypto_lots (opened_by_operation_id);

CREATE INDEX IF NOT EXISTS idx_crypto_lots_open_fifo
    ON budgeting.crypto_lots (bank_account_id, crypto_asset_id, created_at, id)
    WHERE amount_remaining > 0;

