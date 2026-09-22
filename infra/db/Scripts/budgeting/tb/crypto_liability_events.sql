CREATE SCHEMA IF NOT EXISTS budgeting;

-- Historical ledger for version-2 lending. Current protocol metadata is a
-- projection; each asset-side entry has exactly one corresponding debt entry.
CREATE TABLE IF NOT EXISTS budgeting.crypto_liability_events (
    id bigserial PRIMARY KEY,
    protocol_position_id bigint NOT NULL REFERENCES budgeting.crypto_protocol_positions(id),
    portfolio_event_id bigint UNIQUE REFERENCES budgeting.portfolio_events(id),
    crypto_asset_id bigint NOT NULL REFERENCES budgeting.crypto_assets(id),
    event_kind text NOT NULL CHECK (event_kind IN ('borrow', 'principal_repayment', 'interest_accrual', 'repayment', 'liquidation')),
    event_at date NOT NULL,
    external_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    interest_quantity numeric(50,18) NOT NULL DEFAULT 0,
    interest_basis_change_in_base numeric(20,2) NOT NULL DEFAULT 0,
    quantity numeric(50,18) NOT NULL,
    debt_basis_change_in_base numeric(20,2) NOT NULL,
    settlement_value_in_base numeric(20,2),
    asset_cost_consumed_in_base numeric(20,2),
    realized_in_base numeric(20,2),
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CHECK ((event_kind IN ('borrow', 'interest_accrual') AND quantity > 0 AND debt_basis_change_in_base >= 0)
        OR (event_kind IN ('principal_repayment', 'repayment', 'liquidation') AND quantity < 0 AND debt_basis_change_in_base <= 0)),
    CHECK ((event_kind IN ('interest_accrual', 'liquidation') AND external_id IS NOT NULL AND portfolio_event_id IS NULL)
        OR (event_kind NOT IN ('interest_accrual', 'liquidation') AND portfolio_event_id IS NOT NULL)),
    CHECK (quantity::text NOT IN ('NaN', 'Infinity', '-Infinity')),
    CHECK (debt_basis_change_in_base::text NOT IN ('NaN', 'Infinity', '-Infinity'))
);

CREATE INDEX IF NOT EXISTS idx_crypto_liability_events_position
    ON budgeting.crypto_liability_events(protocol_position_id, event_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_liability_external
    ON budgeting.crypto_liability_events(protocol_position_id, external_id) WHERE external_id IS NOT NULL;
