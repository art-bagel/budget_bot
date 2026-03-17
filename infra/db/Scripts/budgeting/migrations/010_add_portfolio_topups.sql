ALTER TABLE budgeting.portfolio_events
    DROP CONSTRAINT IF EXISTS portfolio_events_event_type_check;

ALTER TABLE budgeting.portfolio_events
    ADD CONSTRAINT portfolio_events_event_type_check
    CHECK (event_type IN ('open', 'top_up', 'close', 'income', 'adjustment'));
