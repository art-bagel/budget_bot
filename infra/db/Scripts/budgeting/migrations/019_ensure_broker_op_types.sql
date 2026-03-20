-- Migration 019: ensure broker_input/broker_output op types are registered
-- and idempotency columns exist on bank_entries / portfolio_events.
-- Safe to run even if migration 018 already applied everything.

-- ── Refresh operations type constraint ────────────────────────────────────────

ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN (
        'income', 'allocate', 'group_allocate', 'exchange', 'expense',
        'account_transfer', 'investment_trade', 'investment_income',
        'investment_adjustment', 'reversal', 'credit_taken',
        'broker_input', 'broker_output'
    ));

-- ── Idempotency columns on portfolio_events (if not added by 018) ─────────────

ALTER TABLE budgeting.portfolio_events
    ADD COLUMN IF NOT EXISTS external_id   text,
    ADD COLUMN IF NOT EXISTS import_source varchar(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_events_external
    ON budgeting.portfolio_events (import_source, external_id)
    WHERE external_id IS NOT NULL;

-- ── Idempotency columns on bank_entries (if not added by 018) ────────────────

ALTER TABLE budgeting.bank_entries
    ADD COLUMN IF NOT EXISTS external_id   text,
    ADD COLUMN IF NOT EXISTS import_source varchar(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_entries_external
    ON budgeting.bank_entries (import_source, external_id)
    WHERE external_id IS NOT NULL;
