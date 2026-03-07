CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.lot_consumptions (
    id bigserial PRIMARY KEY,
    operation_id bigint NOT NULL REFERENCES budgeting.operations(id) ON DELETE CASCADE,
    lot_id bigint NOT NULL REFERENCES budgeting.fx_lots(id),
    amount numeric(20, 8) NOT NULL,
    cost_base numeric(20, 2) NOT NULL
);
