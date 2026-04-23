-- Add investment_asset_type to bank_accounts (nullable for non-investment accounts).
-- Values: 'security', 'deposit', 'crypto', 'other' — or NULL for cash/credit accounts.
ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS investment_asset_type varchar(20);

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_investment_asset_type;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_investment_asset_type CHECK (
        (account_kind != 'investment' AND investment_asset_type IS NULL)
        OR
        (account_kind = 'investment' AND investment_asset_type IN ('security', 'deposit', 'crypto', 'other'))
    );

-- Backfill existing investment accounts: default to 'security'.
UPDATE budgeting.bank_accounts
   SET investment_asset_type = 'security'
 WHERE account_kind = 'investment'
   AND investment_asset_type IS NULL;
