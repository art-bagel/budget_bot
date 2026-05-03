CREATE SCHEMA IF NOT EXISTS budgeting;

ALTER TABLE budgeting.portfolio_events
    DROP CONSTRAINT IF EXISTS portfolio_events_event_type_check;

ALTER TABLE budgeting.portfolio_events
    DROP CONSTRAINT IF EXISTS chk_portfolio_events_event_type;

ALTER TABLE budgeting.portfolio_events
    ADD CONSTRAINT chk_portfolio_events_event_type
    CHECK (event_type IN (
        'open',
        'top_up',
        'partial_close',
        'close',
        'income',
        'fee',
        'adjustment',
        'transfer_in',
        'transfer_out',
        'swap_in',
        'swap_out'
    ));
