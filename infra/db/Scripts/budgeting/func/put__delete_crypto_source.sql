-- Delete one manual journal source by rolling back exactly the rows it wrote.
-- Bank model: history is never recalculated. A source is deletable only when no
-- later source or outside write touched its rows; otherwise those go first.
DROP FUNCTION IF EXISTS budgeting.put__delete_crypto_source;
CREATE FUNCTION budgeting.put__delete_crypto_source(
 _user_id bigint, _source_event_id bigint, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
 src record; prior record; m record; t text; predicate text; actual jsonb; assigns text;
 blockers text; last_mutation bigint; muts jsonb; result jsonb; old_source text; old_index text;
BEGIN
 SET search_path TO budgeting;
 IF _request_id IS NULL OR _source_event_id IS NULL THEN RAISE EXCEPTION 'Некорректный запрос удаления'; END IF;
 SELECT * INTO prior FROM crypto_source_deletions WHERE request_id=_request_id;
 IF prior.id IS NOT NULL THEN
  -- A retry answers only the same actor for the same source, with access rechecked.
  IF prior.source_event_id<>_source_event_id OR prior.deleted_by_user_id<>_user_id
     OR NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=(prior.envelope->>'anchor_account_id')::bigint
       AND has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)) THEN
   RAISE EXCEPTION 'Нет доступа к операции';
  END IF;
  RETURN jsonb_build_object('source_event_id',_source_event_id,'deleted',true);
 END IF;
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id;
 IF src.id IS NULL THEN RAISE EXCEPTION 'Операция не найдена'; END IF;
 IF NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=src.anchor_account_id
   AND has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)) THEN
  RAISE EXCEPTION 'Нет доступа к операции';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||src.owner_key,0));
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id FOR UPDATE;
 IF src.id IS NULL THEN RAISE EXCEPTION 'Операция не найдена'; END IF;
 IF src.source_namespace NOT IN ('manual-portfolio-v1','manual-collection-v1','bank-posting-v1') THEN
  RAISE EXCEPTION 'Импортированную операцию удалить нельзя';
 END IF;
 IF NOT src.reversible OR NOT EXISTS(SELECT 1 FROM crypto_source_mutations
   WHERE source_event_id=src.id AND revision=src.revision) THEN
  RAISE EXCEPTION 'У этой операции нет журнала изменений, удалить её нельзя';
 END IF;
 -- Ordinary bank writers do not take the journal lock; block all accounting
 -- writes in one fixed order while the rows are compared and rolled back.
 FOREACH t IN ARRAY ARRAY['bank_accounts','portfolio_positions','portfolio_events','crypto_protocol_positions',
 'crypto_liability_events','crypto_protocol_accrual_events','operations','bank_entries','budget_entries',
 'fx_lots','lot_consumptions','crypto_lots','crypto_lot_consumptions','crypto_bank_entries',
 'current_crypto_balances','current_bank_balances','current_budget_balances','crypto_source_event_links'] LOOP
  EXECUTE format('LOCK TABLE budgeting.%I IN SHARE ROW EXCLUSIVE MODE',t);
 END LOOP;
 -- Dependency: any later journal mutation of a row this source wrote, even if
 -- it later returned the row to the same values.
 SELECT max(id) INTO last_mutation FROM crypto_source_mutations WHERE source_event_id=src.id AND revision=src.revision;
 SELECT string_agg(label,'; ' ORDER BY posted DESC) INTO blockers FROM (
  SELECT DISTINCT e.occurred_at posted, to_char(COALESCE((e.evidence->>'requested_date')::date,e.accounting_date),'DD.MM.YYYY')
   ||' '||COALESCE((SELECT string_agg(c->>'kind',' + ') FROM jsonb_array_elements(e.commands) c),'') label
  FROM crypto_source_mutations mine
  JOIN crypto_source_mutations later ON later.table_name=mine.table_name AND later.row_key=mine.row_key
   AND later.id>last_mutation
  JOIN crypto_source_events e ON e.id=later.source_event_id AND e.revision=later.revision
  WHERE mine.source_event_id=src.id AND mine.revision=src.revision AND e.id<>src.id) b;
 IF blockers IS NOT NULL THEN
  RAISE EXCEPTION 'Сначала удалите более поздние операции, которые её затрагивают: %',blockers;
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(mu) ORDER BY mu.id),'[]'::jsonb) INTO muts
  FROM crypto_source_mutations mu WHERE source_event_id=src.id AND revision=src.revision;
 old_source:=current_setting('budgeting.crypto_source_event_id',true);
 old_index:=current_setting('budgeting.crypto_source_command_index',true);
 CREATE TEMP TABLE IF NOT EXISTS crypto_restore_deleted(table_name text, row_data jsonb) ON COMMIT DROP;
 TRUNCATE pg_temp.crypto_restore_deleted;
 PERFORM set_config('budgeting.crypto_source_event_id','',true);
 PERFORM set_config('budgeting.crypto_restoring','on',true);
 BEGIN
  -- Exact reverse mutation order; a row changed outside the journal is a conflict.
  FOR m IN SELECT * FROM crypto_source_mutations WHERE source_event_id=src.id AND revision=src.revision ORDER BY id DESC LOOP
   SELECT string_agg(format('t.%I=k.%I',key,key),' AND ' ORDER BY key) INTO predicate FROM jsonb_object_keys(m.row_key) key;
   EXECUTE format('SELECT to_jsonb(t) FROM budgeting.%I t, jsonb_populate_record(NULL::budgeting.%I,$1) k WHERE %s',
    m.table_name,m.table_name,predicate) INTO actual USING m.row_key;
   IF actual IS DISTINCT FROM m.after_row THEN
    RAISE EXCEPTION 'После этой операции данные (%) изменены операцией вне журнала. Сначала отмените её',m.table_name;
   END IF;
   IF m.before_row IS NULL THEN
    EXECUTE format('DELETE FROM budgeting.%I t USING jsonb_populate_record(NULL::budgeting.%I,$1) k WHERE %s',m.table_name,m.table_name,predicate) USING m.row_key;
   ELSIF m.after_row IS NULL THEN
    EXECUTE format('INSERT INTO budgeting.%I SELECT * FROM jsonb_populate_record(NULL::budgeting.%I,$1)',m.table_name,m.table_name) USING m.before_row;
   ELSE
    SELECT string_agg(format('%I=x.%I',a.attname,a.attname),',') INTO assigns
     FROM pg_attribute a WHERE a.attrelid=('budgeting.'||m.table_name)::regclass AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format('UPDATE budgeting.%I t SET %s FROM jsonb_populate_record(NULL::budgeting.%I,$1) x, jsonb_populate_record(NULL::budgeting.%I,$2) k WHERE %s',m.table_name,assigns,m.table_name,m.table_name,predicate) USING m.before_row,m.row_key;
   END IF;
  END LOOP;
 EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'На эту операцию ссылается более поздняя (например, сторно). Сначала удалите её';
 END;
 -- A cascade removed a row this source never inserted: someone depended on it.
 IF EXISTS(SELECT 1 FROM pg_temp.crypto_restore_deleted d WHERE NOT EXISTS(
   SELECT 1 FROM crypto_source_mutations mu WHERE mu.source_event_id=src.id AND mu.revision=src.revision
    AND mu.before_row IS NULL AND mu.table_name=d.table_name AND d.row_data @> mu.row_key)) THEN
  RAISE EXCEPTION 'На эту операцию опираются более поздние записи. Сначала удалите их';
 END IF;
 PERFORM set_config('budgeting.crypto_restoring','off',true);
 PERFORM set_config('budgeting.crypto_source_event_id',COALESCE(old_source,''),true);
 PERFORM set_config('budgeting.crypto_source_command_index',COALESCE(old_index,''),true);
 INSERT INTO crypto_source_deletions(request_id,source_event_id,owner_key,source_namespace,source_id,envelope,mutations,
  revisions,corrections,deleted_by_user_id)
 VALUES(_request_id,src.id,src.owner_key,src.source_namespace,src.source_id,to_jsonb(src),muts,
  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM crypto_source_revisions r WHERE r.source_event_id=src.id),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM crypto_source_corrections c WHERE c.source_event_id=src.id),'[]'::jsonb),
  _user_id);
 DELETE FROM crypto_source_corrections WHERE source_event_id=src.id;
 DELETE FROM crypto_source_revisions WHERE source_event_id=src.id;
 DELETE FROM crypto_source_mutations WHERE source_event_id=src.id;
 DELETE FROM crypto_source_event_links WHERE source_event_id=src.id;
 DELETE FROM crypto_source_events WHERE id=src.id;
 result:=jsonb_build_object('source_event_id',src.id,'deleted',true);
 RETURN result;
END $f$;
