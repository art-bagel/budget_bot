ALTER TABLE budgeting.operations
    ADD COLUMN IF NOT EXISTS operated_on date;

UPDATE budgeting.operations
SET operated_on = created_at::date
WHERE operated_on IS NULL;

ALTER TABLE budgeting.operations
    ALTER COLUMN operated_on SET DEFAULT current_date;

ALTER TABLE budgeting.operations
    ALTER COLUMN operated_on SET NOT NULL;

DROP INDEX IF EXISTS budgeting.idx_operations_actor_created_at_id;
CREATE INDEX IF NOT EXISTS idx_operations_actor_created_at_id
    ON budgeting.operations (actor_user_id, operated_on DESC, created_at DESC, id DESC);

DROP INDEX IF EXISTS budgeting.idx_operations_user_owner_type_created_at_id;
CREATE INDEX IF NOT EXISTS idx_operations_user_owner_type_created_at_id
    ON budgeting.operations (owner_user_id, type, operated_on DESC, created_at DESC, id DESC)
    WHERE owner_type = 'user';

DROP INDEX IF EXISTS budgeting.idx_operations_family_owner_type_created_at_id;
CREATE INDEX IF NOT EXISTS idx_operations_family_owner_type_created_at_id
    ON budgeting.operations (owner_family_id, type, operated_on DESC, created_at DESC, id DESC)
    WHERE owner_type = 'family';
