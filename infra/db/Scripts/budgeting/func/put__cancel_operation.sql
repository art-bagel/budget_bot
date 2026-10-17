-- One way to cancel what the history lists: an operation (bank reversal, or a
-- journal rollback that keeps its history row) or a journal event that wrote
-- no operations row.
DROP FUNCTION IF EXISTS budgeting.put__cancel_operation;
CREATE FUNCTION budgeting.put__cancel_operation(_user_id bigint, _operation_id bigint, _source_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE op bigint;
BEGIN
 IF (_operation_id IS NULL) = (_source_event_id IS NULL) THEN RAISE EXCEPTION 'Некорректная отмена'; END IF;
 IF _operation_id IS NOT NULL THEN
  RETURN budgeting.put__reverse_operation(_user_id, _operation_id);
 END IF;
 -- An event with an operations row goes the operation way: one lock order
 -- (operation row, then journal lock) for both entry points, no deadlock.
 SELECT ledger_id INTO op FROM budgeting.crypto_source_event_links
  WHERE source_event_id = _source_event_id AND ledger_table = 'operations' LIMIT 1;
 IF op IS NOT NULL THEN
  RETURN budgeting.put__reverse_operation(_user_id, op);
 END IF;
 RETURN budgeting.put__delete_crypto_source(_user_id, _source_event_id, gen_random_uuid());
END $f$;
