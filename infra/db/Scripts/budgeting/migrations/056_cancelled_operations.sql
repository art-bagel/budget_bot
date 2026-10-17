-- A cancelled journal operation stays visible in the history (bank model):
-- its accounting rows are rolled back, this frozen history row remains.
CREATE TABLE IF NOT EXISTS budgeting.cancelled_operations (
 id bigserial PRIMARY KEY,
 deletion_id bigint NOT NULL REFERENCES budgeting.crypto_source_deletions(id) ON DELETE CASCADE,
 -- The rolled-back operations row; NULL for a journal event without one.
 operation_id bigint UNIQUE,
 owner_type text NOT NULL CHECK (owner_type IN ('user','family')),
 owner_user_id bigint,
 owner_family_id bigint,
 operated_on date NOT NULL,
 created_at timestamptz NOT NULL,
 -- get__operations_history item at cancel time; NULL when it was hidden (archived accounts).
 item jsonb,
 -- History filters evaluated by the live query before the rollback.
 is_investment boolean NOT NULL,
 is_banking boolean NOT NULL,
 asset_types text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS cancelled_operations_owner
 ON budgeting.cancelled_operations(owner_type,owner_user_id,owner_family_id,operated_on);
CREATE INDEX IF NOT EXISTS cancelled_operations_deletion ON budgeting.cancelled_operations(deletion_id);
-- The separate operations history is replaced by the ordinary list.
DROP FUNCTION IF EXISTS budgeting.get__crypto_correction_history;
