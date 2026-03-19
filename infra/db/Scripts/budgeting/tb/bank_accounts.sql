CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.bank_accounts (
    id bigserial PRIMARY KEY,
    owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    account_kind varchar(20) NOT NULL DEFAULT 'cash' CHECK (account_kind IN ('cash', 'investment', 'credit')),
    credit_kind varchar(30),
    interest_rate numeric(5, 2),
    payment_day smallint,
    credit_started_at date,
    credit_ends_at date,
    provider_name varchar(150),
    provider_account_ref varchar(150),
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_bank_accounts_owner CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id IS NULL AND owner_family_id IS NOT NULL)
    ),
    CONSTRAINT chk_bank_accounts_non_cash_primary
        CHECK (account_kind = 'cash' OR is_primary = false),
    CONSTRAINT chk_bank_accounts_credit_fields CHECK (
        account_kind = 'credit'
        OR (credit_kind IS NULL AND interest_rate IS NULL AND payment_day IS NULL AND credit_started_at IS NULL AND credit_ends_at IS NULL)
    ),
    CONSTRAINT chk_bank_accounts_payment_day CHECK (
        payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31)
    ),
    CONSTRAINT chk_bank_accounts_credit_kind CHECK (
        credit_kind IS NULL OR credit_kind IN ('loan', 'credit_card', 'mortgage')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_user_name
    ON budgeting.bank_accounts (owner_user_id, name)
    WHERE owner_type = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_family_name
    ON budgeting.bank_accounts (owner_family_id, name)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_active
    ON budgeting.bank_accounts (owner_user_id, is_active, id)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_family_active
    ON budgeting.bank_accounts (owner_family_id, is_active, id)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_kind_active
    ON budgeting.bank_accounts (owner_user_id, account_kind, is_active, id)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_family_kind_active
    ON budgeting.bank_accounts (owner_family_id, account_kind, is_active, id)
    WHERE owner_type = 'family';

-- At most one primary account per owner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_user_primary
    ON budgeting.bank_accounts (owner_user_id)
    WHERE owner_type = 'user' AND is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_family_primary
    ON budgeting.bank_accounts (owner_family_id)
    WHERE owner_type = 'family' AND is_primary = true;
