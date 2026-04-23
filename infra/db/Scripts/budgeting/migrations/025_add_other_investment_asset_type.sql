ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_investment_asset_type;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_investment_asset_type CHECK (
        (account_kind != 'investment' AND investment_asset_type IS NULL)
        OR
        (account_kind = 'investment' AND investment_asset_type IN ('security', 'deposit', 'crypto', 'other'))
    );
