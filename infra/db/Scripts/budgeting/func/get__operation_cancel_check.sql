-- Can this history row be cancelled, and if not, why: the real cancel runs in a
-- subtransaction that is always rolled back, so the reason never drifts from
-- the cancel itself. Access is checked first and raised, never returned.
DROP FUNCTION IF EXISTS budgeting.get__operation_cancel_check;
CREATE FUNCTION budgeting.get__operation_cancel_check(_user_id bigint, _operation_id bigint, _source_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o_type text; o_user bigint; o_family bigint; reason text;
BEGIN
 SET search_path TO budgeting;
 IF (_operation_id IS NULL) = (_source_event_id IS NULL) THEN RAISE EXCEPTION 'Некорректная отмена'; END IF;
 IF _operation_id IS NOT NULL THEN
  SELECT owner_type, owner_user_id, owner_family_id INTO o_type, o_user, o_family FROM operations WHERE id = _operation_id;
  IF o_type IS NULL THEN
   SELECT owner_type, owner_user_id, owner_family_id INTO o_type, o_user, o_family FROM cancelled_operations WHERE operation_id = _operation_id;
  END IF;
 ELSE
  SELECT a.owner_type, a.owner_user_id, a.owner_family_id INTO o_type, o_user, o_family
   FROM crypto_source_events s JOIN bank_accounts a ON a.id = s.anchor_account_id WHERE s.id = _source_event_id;
  IF o_type IS NULL THEN
   SELECT co.owner_type, co.owner_user_id, co.owner_family_id INTO o_type, o_user, o_family FROM cancelled_operations co
    JOIN crypto_source_deletions d ON d.id = co.deletion_id WHERE d.source_event_id = _source_event_id LIMIT 1;
  END IF;
 END IF;
 IF o_type IS NULL THEN RAISE EXCEPTION 'Операция не найдена'; END IF;
 IF NOT has__owner_access(_user_id, o_type, o_user, o_family) THEN
  RAISE EXCEPTION 'Нет доступа к операции';
 END IF;
 BEGIN
  PERFORM put__cancel_operation(_user_id, _operation_id, _source_event_id);
  RAISE EXCEPTION USING ERRCODE = 'P0C01', MESSAGE = 'cancel dry run';
 EXCEPTION
  WHEN SQLSTATE 'P0C01' THEN reason := NULL;
  WHEN raise_exception THEN reason := SQLERRM;
 END;
 RETURN jsonb_build_object('can_cancel', reason IS NULL, 'reason', reason);
END $f$;
