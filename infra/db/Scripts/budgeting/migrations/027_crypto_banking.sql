CREATE TABLE IF NOT EXISTS budgeting.crypto_assets (
    id bigserial PRIMARY KEY,
    symbol varchar(30) NOT NULL,
    name varchar(150) NOT NULL,
    network_code varchar(50) NOT NULL DEFAULT 'manual',
    contract_address varchar(150) NOT NULL DEFAULT '',
    decimals smallint NOT NULL DEFAULT 8 CHECK (decimals >= 0 AND decimals <= 30),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

UPDATE budgeting.crypto_assets
SET contract_address = ''
WHERE contract_address IS NULL;

ALTER TABLE budgeting.crypto_assets
    ALTER COLUMN contract_address SET DEFAULT '',
    ALTER COLUMN contract_address SET NOT NULL;

DROP INDEX IF EXISTS budgeting.uq_crypto_assets_identity;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_assets_identity
    ON budgeting.crypto_assets (symbol, network_code, contract_address);

INSERT INTO budgeting.crypto_assets (symbol, name, network_code, decimals)
VALUES
    ('TON', 'Toncoin', 'ton', 9),
    ('USDT', 'Tether USD', 'ton', 6),
    ('BTC', 'Bitcoin', 'bitcoin', 8),
    ('ETH', 'Ether', 'ethereum', 18)
ON CONFLICT (symbol, network_code, contract_address) DO NOTHING;

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

CREATE TABLE IF NOT EXISTS budgeting.crypto_lot_consumptions (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    lot_id bigint NOT NULL REFERENCES budgeting.crypto_lots(id),
    amount numeric(30, 12) NOT NULL,
    cost_base numeric(20, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crypto_lot_consumptions_operation_id
    ON budgeting.crypto_lot_consumptions (operation_id);

CREATE INDEX IF NOT EXISTS idx_crypto_lot_consumptions_lot_id
    ON budgeting.crypto_lot_consumptions (lot_id);

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
