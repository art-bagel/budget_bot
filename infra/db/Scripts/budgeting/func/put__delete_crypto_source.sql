-- Delete one manual crypto/collection journal source by rolling back exactly the rows it wrote.
-- Bank model: history is never recalculated. A source is deletable only when no
-- later source or outside write touched its rows; otherwise those go first.
DROP FUNCTION IF EXISTS budgeting.put__delete_crypto_source;
CREATE FUNCTION budgeting.put__delete_crypto_source(
 _user_id bigint, _source_event_id bigint, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
 src record; prior record; m record; t text; predicate text; actual jsonb; assigns text;
 blockers text; last_mutation bigint; muts jsonb; result jsonb; old_source text; old_index text;
 snaps jsonb; deletion bigint;
BEGIN
 SET search_path TO budgeting;
 IF _request_id IS NULL OR _source_event_id IS NULL THEN RAISE EXCEPTION 'Некорректный запрос удаления'; END IF;
 SELECT * INTO prior FROM crypto_source_deletions WHERE request_id=_request_id;
 IF prior.id IS NOT NULL THEN
  -- A retry answers only the same actor for the same source, with access rechecked.
  IF prior.source_event_id<>_source_event_id OR prior.deleted_by_user_id IS DISTINCT FROM _user_id
     OR NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=(prior.envelope->>'anchor_account_id')::bigint
       AND has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)) THEN
   RAISE EXCEPTION 'Нет доступа к операции';
  END IF;
  RETURN jsonb_build_object('source_event_id',_source_event_id,'deleted',true);
 END IF;
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id;
 IF src.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM crypto_source_deletions d WHERE d.source_event_id=_source_event_id
    AND d.owner_key IN ('user:'||_user_id,'family:'||get__user_family_id(_user_id))) THEN
   RAISE EXCEPTION 'Операция уже отменена';
  END IF;
  RAISE EXCEPTION 'Операция не найдена';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=src.anchor_account_id
   AND has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)) THEN
  RAISE EXCEPTION 'Нет доступа к операции';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||src.owner_key,0));
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id FOR UPDATE;
 IF src.id IS NULL THEN RAISE EXCEPTION 'Операция уже отменена'; END IF;
 -- Bank postings (ordinary expenses too) are undone by a reversal, not here.
 IF src.source_namespace NOT IN ('manual-portfolio-v1','manual-collection-v1') THEN
  RAISE EXCEPTION 'Эту операцию нельзя отменить таким способом';
 END IF;
 IF NOT src.reversible OR NOT EXISTS(SELECT 1 FROM crypto_source_mutations
   WHERE source_event_id=src.id AND revision=src.revision) THEN
  RAISE EXCEPTION 'Эту операцию нельзя отменить: у неё нет журнала изменений';
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
  RAISE EXCEPTION 'Сначала отмените более поздние операции, которые её затрагивают: %',blockers;
 END IF;
 -- Bank model: the cancelled operation stays listed. Keep its history rows as
 -- the live query renders them now, before the rows are rolled back.
 SELECT jsonb_agg(get__cancel_snapshot(_user_id,o.id,NULL)||jsonb_build_object('operation_id',o.id,
   'owner_type',o.owner_type,'owner_user_id',o.owner_user_id,'owner_family_id',o.owner_family_id,
   'operated_on',o.operated_on,'created_at',o.created_at) ORDER BY o.id) INTO snaps
  FROM crypto_source_event_links l JOIN operations o ON o.id=l.ledger_id
  WHERE l.source_event_id=src.id AND l.ledger_table='operations';
 IF snaps IS NULL THEN
  SELECT jsonb_build_array(get__cancel_snapshot(_user_id,NULL,src.id)||jsonb_build_object('operation_id',NULL,
    'owner_type',a.owner_type,'owner_user_id',a.owner_user_id,'owner_family_id',a.owner_family_id,
    'operated_on',COALESCE((src.evidence->>'requested_date')::date,(src.commands->0->'payload'->>'operated_at')::date,src.accounting_date),
    'created_at',src.created_at)) INTO snaps
   FROM bank_accounts a WHERE a.id=src.anchor_account_id;
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
   -- Values decide, not the touch time: a reversed outside write leaves the row as it was.
   IF (actual-'updated_at') IS DISTINCT FROM (m.after_row-'updated_at') THEN
    RAISE EXCEPTION 'Не отменить: после этой операции % изменён другой операцией (перевод, расход, правка). Сначала отмените её',
     CASE WHEN m.table_name IN ('current_bank_balances','bank_entries') THEN 'остаток денег на счёте'
          WHEN m.table_name IN ('current_crypto_balances','crypto_lots','crypto_bank_entries','crypto_lot_consumptions') THEN 'остаток монет'
          WHEN m.table_name IN ('current_budget_balances','budget_entries') THEN 'бюджет'
          WHEN m.table_name IN ('portfolio_positions','portfolio_events') THEN 'предмет или позиция'
          ELSE 'учёт' END;
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
  RAISE EXCEPTION 'На эту операцию ссылается более поздняя (например, отмена). Сначала отмените её';
 END;
 -- A cascade removed a row this source never inserted: someone depended on it.
 IF EXISTS(SELECT 1 FROM pg_temp.crypto_restore_deleted d WHERE NOT EXISTS(
   SELECT 1 FROM crypto_source_mutations mu WHERE mu.source_event_id=src.id AND mu.revision=src.revision
    AND mu.before_row IS NULL AND mu.table_name=d.table_name AND d.row_data @> mu.row_key)) THEN
  RAISE EXCEPTION 'На эту операцию опираются более поздние записи. Сначала отмените их';
 END IF;
 PERFORM set_config('budgeting.crypto_restoring','off',true);
 PERFORM set_config('budgeting.crypto_source_event_id',COALESCE(old_source,''),true);
 PERFORM set_config('budgeting.crypto_source_command_index',COALESCE(old_index,''),true);
 INSERT INTO crypto_source_deletions(request_id,source_event_id,owner_key,source_namespace,source_id,envelope,mutations,
  revisions,corrections,deleted_by_user_id)
 VALUES(_request_id,src.id,src.owner_key,src.source_namespace,src.source_id,to_jsonb(src),muts,
  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM crypto_source_revisions r WHERE r.source_event_id=src.id),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM crypto_source_corrections c WHERE c.source_event_id=src.id),'[]'::jsonb),
  _user_id) RETURNING id INTO deletion;
 INSERT INTO cancelled_operations(deletion_id,operation_id,owner_type,owner_user_id,owner_family_id,operated_on,created_at,
  item,is_investment,is_banking,asset_types)
 SELECT deletion,(x->>'operation_id')::bigint,x->>'owner_type',(x->>'owner_user_id')::bigint,(x->>'owner_family_id')::bigint,
  (x->>'operated_on')::date,(x->>'created_at')::timestamptz,NULLIF(x->'item','null'::jsonb),
  (x->>'is_investment')::boolean,(x->>'is_banking')::boolean,ARRAY(SELECT jsonb_array_elements_text(x->'asset_types'))
 FROM jsonb_array_elements(snaps) x;
 DELETE FROM crypto_source_corrections WHERE source_event_id=src.id;
 DELETE FROM crypto_source_revisions WHERE source_event_id=src.id;
 DELETE FROM crypto_source_mutations WHERE source_event_id=src.id;
 DELETE FROM crypto_source_event_links WHERE source_event_id=src.id;
 DELETE FROM crypto_source_events WHERE id=src.id;
 result:=jsonb_build_object('source_event_id',src.id,'deleted',true);
 RETURN result;
END $f$;
