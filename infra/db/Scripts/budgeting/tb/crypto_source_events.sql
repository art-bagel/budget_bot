CREATE SCHEMA IF NOT EXISTS budgeting;

-- An immutable input envelope. The accounting projections remain in the existing ledgers.
CREATE TABLE IF NOT EXISTS budgeting.crypto_source_events (
    id bigserial PRIMARY KEY,
    owner_key text NOT NULL,
    anchor_account_id bigint NOT NULL REFERENCES budgeting.bank_accounts(id),
    source_namespace text NOT NULL CHECK (btrim(source_namespace) <> ''),
    source_id text NOT NULL CHECK (btrim(source_id) <> ''),
    occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
    order_in_timestamp bigint NOT NULL CHECK (order_in_timestamp >= 0),
    accounting_date date NOT NULL CHECK (isfinite(accounting_date)),
    commands jsonb NOT NULL CHECK (jsonb_typeof(commands) = 'array' AND jsonb_array_length(commands) BETWEEN 1 AND 100),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    result jsonb,
    created_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    UNIQUE(owner_key, source_namespace, source_id),
    UNIQUE(owner_key, occurred_at, order_in_timestamp)
);

CREATE TABLE IF NOT EXISTS budgeting.crypto_source_event_links (
    source_event_id bigint NOT NULL REFERENCES budgeting.crypto_source_events(id),
    command_index integer NOT NULL CHECK (command_index >= 0),
    ledger_table text NOT NULL CHECK (ledger_table IN
        ('operations','portfolio_events','crypto_liability_events','crypto_protocol_accrual_events')),
    ledger_id bigint NOT NULL,
    PRIMARY KEY(ledger_table,ledger_id)
);
CREATE INDEX IF NOT EXISTS idx_crypto_source_event_links_source
    ON budgeting.crypto_source_event_links(source_event_id,command_index);
