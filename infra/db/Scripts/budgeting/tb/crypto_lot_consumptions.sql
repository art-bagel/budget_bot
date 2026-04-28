CREATE SCHEMA IF NOT EXISTS budgeting;

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

