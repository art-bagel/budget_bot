ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS operations_type_check;

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'account_transfer', 'investment_income', 'reversal'));

ALTER TABLE budgeting.portfolio_events
    ADD COLUMN IF NOT EXISTS linked_operation_id bigint REFERENCES budgeting.operations(id);

ALTER TABLE budgeting.portfolio_events
    DROP CONSTRAINT IF EXISTS portfolio_events_event_type_check;

ALTER TABLE budgeting.portfolio_events
    ADD CONSTRAINT portfolio_events_event_type_check
    CHECK (event_type IN ('open', 'close', 'income'));

CREATE INDEX IF NOT EXISTS idx_portfolio_events_linked_operation
    ON budgeting.portfolio_events (linked_operation_id)
    WHERE linked_operation_id IS NOT NULL;
