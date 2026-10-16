-- Reversible write sets are captured prospectively; legacy events remain explicit.
ALTER TABLE budgeting.crypto_source_events ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE budgeting.crypto_source_events ADD COLUMN IF NOT EXISTS reversible boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS budgeting.crypto_source_mutations (
 id bigserial PRIMARY KEY,
 source_event_id bigint NOT NULL REFERENCES budgeting.crypto_source_events(id),
 revision integer NOT NULL,
 command_index integer NOT NULL,
 table_name text NOT NULL,
 row_key jsonb NOT NULL,
 before_row jsonb,
 after_row jsonb
);
CREATE INDEX IF NOT EXISTS crypto_mutations_source ON budgeting.crypto_source_mutations(source_event_id,revision,id);
CREATE TABLE IF NOT EXISTS budgeting.crypto_source_revisions (
 source_event_id bigint NOT NULL REFERENCES budgeting.crypto_source_events(id),
 revision integer NOT NULL,
 envelope jsonb NOT NULL,
 superseded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_event_id,revision)
);
CREATE TABLE IF NOT EXISTS budgeting.crypto_source_corrections (
 request_id uuid PRIMARY KEY,
 source_event_id bigint NOT NULL REFERENCES budgeting.crypto_source_events(id),
 actor_user_id bigint NOT NULL REFERENCES budgeting.users(id),
 reason text NOT NULL CHECK(btrim(reason)<>''),
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Deleted journal sources: audit and tombstone. No FK to the event, which is gone.
CREATE TABLE IF NOT EXISTS budgeting.crypto_source_deletions (
 id bigserial PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 source_event_id bigint NOT NULL UNIQUE,
 owner_key text NOT NULL,
 source_namespace text NOT NULL,
 source_id text NOT NULL,
 envelope jsonb NOT NULL,
 mutations jsonb NOT NULL,
 revisions jsonb NOT NULL DEFAULT '[]'::jsonb,
 corrections jsonb NOT NULL DEFAULT '[]'::jsonb,
 -- Audit outlives the account: deleting the user clears the reference.
 deleted_by_user_id bigint REFERENCES budgeting.users(id) ON DELETE SET NULL,
 deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crypto_source_deletions_source
 ON budgeting.crypto_source_deletions(owner_key,source_namespace,source_id);
-- Dependency check: later mutations of the same accounting row.
CREATE INDEX IF NOT EXISTS crypto_mutations_row ON budgeting.crypto_source_mutations(table_name,row_key,id);
