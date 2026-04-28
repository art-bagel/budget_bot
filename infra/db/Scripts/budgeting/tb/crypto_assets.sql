CREATE SCHEMA IF NOT EXISTS budgeting;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_assets_identity
    ON budgeting.crypto_assets (symbol, network_code, contract_address);

INSERT INTO budgeting.crypto_assets (symbol, name, network_code, decimals)
VALUES
    ('TON', 'Toncoin', 'ton', 9),
    ('USDT', 'Tether USD', 'ton', 6),
    ('BTC', 'Bitcoin', 'bitcoin', 8),
    ('ETH', 'Ether', 'ethereum', 18)
ON CONFLICT (symbol, network_code, contract_address) DO NOTHING;
