CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.crypto_bank_entries (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    bank_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    crypto_asset_id bigint NOT NULL REFERENCES budgeting.crypto_assets(id),
    amount numeric(30, 12) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crypto_bank_entries_operation_id
    ON budgeting.crypto_bank_entries (operation_id);

CREATE INDEX IF NOT EXISTS idx_crypto_bank_entries_account_asset
    ON budgeting.crypto_bank_entries (bank_account_id, crypto_asset_id);

