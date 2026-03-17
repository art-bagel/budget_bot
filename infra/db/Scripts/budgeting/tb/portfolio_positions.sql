CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.portfolio_positions (
    id bigserial PRIMARY KEY,
    owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    investment_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    asset_type_code varchar(30) NOT NULL,
    title varchar(150) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    quantity numeric(20, 8),
    amount_in_currency numeric(20, 8) NOT NULL CHECK (amount_in_currency > 0),
    currency_code char(3) NOT NULL REFERENCES budgeting.currencies(code),
    opened_at date NOT NULL DEFAULT CURRENT_DATE,
    closed_at date,
    close_amount_in_currency numeric(20, 8),
    close_currency_code char(3) REFERENCES budgeting.currencies(code),
    comment text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_portfolio_positions_owner CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id IS NULL AND owner_family_id IS NOT NULL)
    ),
    CONSTRAINT chk_portfolio_positions_close_fields CHECK (
        (status = 'open' AND closed_at IS NULL AND close_amount_in_currency IS NULL AND close_currency_code IS NULL)
        OR
        (status = 'closed' AND closed_at IS NOT NULL AND close_amount_in_currency IS NOT NULL AND close_currency_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_user_status_created
    ON budgeting.portfolio_positions (owner_user_id, status, opened_at DESC, id DESC)
    WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_family_status_created
    ON budgeting.portfolio_positions (owner_family_id, status, opened_at DESC, id DESC)
    WHERE owner_type = 'family';

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_account_status
    ON budgeting.portfolio_positions (investment_account_id, status, opened_at DESC, id DESC);
