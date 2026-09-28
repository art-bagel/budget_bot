CREATE TABLE IF NOT EXISTS budgeting.crypto_asset_visibility (
    user_id bigint NOT NULL REFERENCES budgeting.users(id),
    investment_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    crypto_asset_id bigint NOT NULL REFERENCES budgeting.crypto_assets(id),
    PRIMARY KEY (user_id, investment_account_id, crypto_asset_id)
);
