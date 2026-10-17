-- One way to cancel what the history lists: an operation (bank reversal, or a
-- journal rollback that keeps its history row) or a journal event that wrote
-- no operations row.
DROP FUNCTION IF EXISTS budgeting.put__cancel_operation;
CREATE FUNCTION budgeting.put__cancel_operation(_user_id bigint, _operation_id bigint, _source_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
 IF (_operation_id IS NULL) = (_source_event_id IS NULL) THEN RAISE EXCEPTION 'Некорректная отмена'; END IF;
 IF _operation_id IS NOT NULL THEN
  RETURN budgeting.put__reverse_operation(_user_id, _operation_id);
 END IF;
 RETURN budgeting.put__delete_crypto_source(_user_id, _source_event_id, gen_random_uuid());
END $f$;
