ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS account_kind varchar(20);

UPDATE budgeting.bank_accounts
SET account_kind = 'cash'
WHERE account_kind IS NULL;

ALTER TABLE budgeting.bank_accounts
    ALTER COLUMN account_kind SET DEFAULT 'cash';

ALTER TABLE budgeting.bank_accounts
    ALTER COLUMN account_kind SET NOT NULL;

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_account_kind;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_account_kind
    CHECK (account_kind IN ('cash', 'investment'));

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS provider_name varchar(150);

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS provider_account_ref varchar(150);

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_investment_primary;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_investment_primary
    CHECK (account_kind = 'cash' OR is_primary = false);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_kind_active
    ON budgeting.bank_accounts (owner_user_id, account_kind, is_active, id)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_family_kind_active
    ON budgeting.bank_accounts (owner_family_id, account_kind, is_active, id)
    WHERE owner_type = 'family';
