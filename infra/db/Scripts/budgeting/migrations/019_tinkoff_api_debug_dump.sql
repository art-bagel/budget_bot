CREATE TABLE IF NOT EXISTS budgeting.tinkoff_api_debug_snapshots (
    id bigserial PRIMARY KEY,
    connection_id bigint REFERENCES budgeting.external_connections(id) ON DELETE CASCADE,
    owner_user_id bigint REFERENCES budgeting.users(id),
    owner_family_id bigint REFERENCES budgeting.families(id) ON DELETE CASCADE,
    linked_account_id bigint REFERENCES budgeting.bank_accounts(id),
    provider_account_id varchar(64),
    endpoint varchar(64) NOT NULL,
    requested_from timestamptz,
    requested_to timestamptz,
    request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    record_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_tinkoff_api_debug_snapshots_conn_endpoint_created
    ON budgeting.tinkoff_api_debug_snapshots (connection_id, endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tinkoff_api_debug_snapshots_linked_account_created
    ON budgeting.tinkoff_api_debug_snapshots (linked_account_id, created_at DESC);


CREATE TABLE IF NOT EXISTS budgeting.tinkoff_api_debug_items (
    id bigserial PRIMARY KEY,
    snapshot_id bigint NOT NULL REFERENCES budgeting.tinkoff_api_debug_snapshots(id) ON DELETE CASCADE,
    connection_id bigint REFERENCES budgeting.external_connections(id) ON DELETE CASCADE,
    linked_account_id bigint REFERENCES budgeting.bank_accounts(id),
    provider_account_id varchar(64),
    item_type varchar(64) NOT NULL,
    external_id text,
    item_at timestamptz,
    item_index integer NOT NULL DEFAULT 0,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_tinkoff_api_debug_items_snapshot
    ON budgeting.tinkoff_api_debug_items (snapshot_id, item_index);

CREATE INDEX IF NOT EXISTS idx_tinkoff_api_debug_items_account_type
    ON budgeting.tinkoff_api_debug_items (linked_account_id, item_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tinkoff_api_debug_items_external_id
    ON budgeting.tinkoff_api_debug_items (external_id)
    WHERE external_id IS NOT NULL;
