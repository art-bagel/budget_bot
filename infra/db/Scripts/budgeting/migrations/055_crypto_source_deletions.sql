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
 deleted_by_user_id bigint NOT NULL REFERENCES budgeting.users(id),
 deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crypto_source_deletions_source
 ON budgeting.crypto_source_deletions(owner_key,source_namespace,source_id);
-- Dependency check: later mutations of the same accounting row.
CREATE INDEX IF NOT EXISTS crypto_mutations_row ON budgeting.crypto_source_mutations(table_name,row_key,id);
-- History recalculation is replaced by deleting a journal source.
DROP FUNCTION IF EXISTS budgeting.put__correct_crypto_source;
