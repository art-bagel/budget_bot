ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS operations_type_check;

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN ('income', 'allocate', 'group_allocate', 'exchange', 'expense', 'account_transfer', 'investment_trade', 'investment_income', 'reversal'));
