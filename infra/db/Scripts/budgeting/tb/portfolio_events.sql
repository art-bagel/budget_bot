CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.portfolio_events (
    id bigserial PRIMARY KEY,
    position_id bigint NOT NULL REFERENCES budgeting.portfolio_positions(id) ON DELETE CASCADE,
    event_type varchar(30) NOT NULL CHECK (event_type IN ('open', 'close', 'income')),
    event_at date NOT NULL DEFAULT CURRENT_DATE,
    quantity numeric(20, 8),
    amount numeric(20, 8),
    currency_code char(3) REFERENCES budgeting.currencies(code),
    linked_operation_id bigint REFERENCES budgeting.operations(id),
    comment text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_portfolio_events_position_created
    ON budgeting.portfolio_events (position_id, event_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_events_linked_operation
    ON budgeting.portfolio_events (linked_operation_id)
    WHERE linked_operation_id IS NOT NULL;
