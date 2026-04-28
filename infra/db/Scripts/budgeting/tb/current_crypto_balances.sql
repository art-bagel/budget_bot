CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.current_crypto_balances (
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id) ON DELETE CASCADE,
    crypto_asset_id bigint NOT NULL REFERENCES budgeting.crypto_assets(id),
    amount numeric(30, 12) NOT NULL DEFAULT 0,
    cost_base_remaining numeric(20, 2) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (bank_account_id, crypto_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_current_crypto_balances_asset
    ON budgeting.current_crypto_balances (crypto_asset_id, bank_account_id);

