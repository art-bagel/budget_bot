CREATE SCHEMA IF NOT EXISTS budgeting;

-- One source event may accrue collateral and interest together. The liability
-- event records the interest expense; this row does not recognize it twice.
CREATE TABLE IF NOT EXISTS budgeting.crypto_protocol_accrual_events (
    id bigserial PRIMARY KEY,
    protocol_position_id bigint NOT NULL REFERENCES budgeting.crypto_protocol_positions(id),
    external_id text NOT NULL CHECK (btrim(external_id) <> ''),
    event_at date NOT NULL,
    collateral_quantity numeric(50,18) NOT NULL,
    interest_quantity numeric(50,18) NOT NULL,
    liability_event_id bigint UNIQUE REFERENCES budgeting.crypto_liability_events(id),
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    UNIQUE(protocol_position_id,external_id),
    CHECK (collateral_quantity >= 0 AND interest_quantity >= 0
        AND collateral_quantity + interest_quantity > 0),
    CHECK (collateral_quantity::text NOT IN ('NaN','Infinity','-Infinity')
        AND interest_quantity::text NOT IN ('NaN','Infinity','-Infinity')),
    CHECK ((interest_quantity > 0 AND liability_event_id IS NOT NULL)
        OR (interest_quantity = 0 AND liability_event_id IS NULL))
);
