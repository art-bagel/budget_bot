CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.crypto_protocol_positions (
    id bigserial PRIMARY KEY,
    owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'family')),
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    investment_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    crypto_asset_id bigint REFERENCES budgeting.crypto_assets(id),
    protocol_name varchar(150) NOT NULL,
    position_type varchar(30) NOT NULL CHECK (position_type IN ('staking', 'lending', 'liquidity_pool', 'vault', 'other')),
    status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    network_code varchar(50),
    asset_symbol varchar(80) NOT NULL,
    quantity numeric(30, 12),
    cost_basis_in_base numeric(20, 2) NOT NULL DEFAULT 0,
    current_quantity numeric(30, 12),
    current_value_in_base numeric(20, 2) NOT NULL DEFAULT 0,
    rewards_claimed_in_base numeric(20, 2) NOT NULL DEFAULT 0,
    rewards_unclaimed_in_base numeric(20, 2) NOT NULL DEFAULT 0,
    deposited_at date NOT NULL DEFAULT current_date,
    withdrawn_at date,
    comment text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT chk_crypto_protocol_positions_owner CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_user_id IS NULL AND owner_family_id IS NOT NULL)
    ),
    CONSTRAINT chk_crypto_protocol_positions_closed CHECK (
        (status = 'open' AND withdrawn_at IS NULL)
        OR
        (status = 'closed' AND withdrawn_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_crypto_protocol_positions_account_status
    ON budgeting.crypto_protocol_positions (investment_account_id, status, deposited_at DESC, id DESC);

