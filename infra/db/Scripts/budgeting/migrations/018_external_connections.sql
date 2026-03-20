пр-- Migration 018: external connections for broker integrations (Tinkoff, etc.)
-- Creates generic external_connections table and adds idempotency columns
-- to portfolio_events and bank_entries. Also adds broker_input/broker_output
-- operation types.

-- ── External connections ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budgeting.external_connections (
    id                    bigserial PRIMARY KEY,
    owner_type            varchar(20) NOT NULL,
    owner_user_id         bigint REFERENCES budgeting.users(id),
    owner_family_id       bigint REFERENCES budgeting.families(id),
    provider              varchar(30) NOT NULL,        -- 'tinkoff', 'interactive_brokers', ...
    provider_account_id   text        NOT NULL,        -- broker-side account ID
    linked_account_id     bigint REFERENCES budgeting.bank_accounts(id),
    credentials           jsonb       NOT NULL DEFAULT '{}',  -- encrypted token etc.
    settings              jsonb       NOT NULL DEFAULT '{}',  -- {"sync_from": "2024-01-01"}
    last_synced_at        timestamptz,
    is_active             boolean     NOT NULL DEFAULT true,
    created_at            timestamptz          DEFAULT now(),
    CONSTRAINT chk_ext_conn_owner CHECK (
        (owner_type = 'user'   AND owner_user_id   IS NOT NULL AND owner_family_id IS NULL)
        OR
        (owner_type = 'family' AND owner_family_id IS NOT NULL AND owner_user_id   IS NULL)
    ),
    CONSTRAINT uq_ext_conn UNIQUE (provider, provider_account_id, owner_user_id, owner_family_id)
);

-- ── Idempotency columns on portfolio_events ───────────────────────────────────

ALTER TABLE budgeting.portfolio_events
    ADD COLUMN IF NOT EXISTS external_id   text,
    ADD COLUMN IF NOT EXISTS import_source varchar(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_events_external
    ON budgeting.portfolio_events (import_source, external_id)
    WHERE external_id IS NOT NULL;

-- ── Idempotency columns on bank_entries ──────────────────────────────────────

ALTER TABLE budgeting.bank_entries
    ADD COLUMN IF NOT EXISTS external_id   text,
    ADD COLUMN IF NOT EXISTS import_source varchar(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_entries_external
    ON budgeting.bank_entries (import_source, external_id)
    WHERE external_id IS NOT NULL;

-- ── New operation types for broker cash flows ─────────────────────────────────

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
