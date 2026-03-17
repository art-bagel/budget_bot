ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS operations_type_check;

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'account_transfer', 'investment_trade', 'investment_income', 'investment_adjustment', 'reversal'));

ALTER TABLE budgeting.portfolio_events
    DROP CONSTRAINT IF EXISTS portfolio_events_event_type_check;

ALTER TABLE budgeting.portfolio_events
    ADD CONSTRAINT portfolio_events_event_type_check
    CHECK (event_type IN ('open', 'close', 'income', 'adjustment'));
