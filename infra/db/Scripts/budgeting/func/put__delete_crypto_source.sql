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
 snaps jsonb; deletion bigint; relaxed bigint[]; k record; gaps jsonb:='{}'; deltas jsonb:='[]'; now_amount numeric;
 acc record; sym text; free_total numeric;
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
 -- Shared balances are sums of many operations' rows, rebuilt from entries
 -- and lots (rebuild_current_balances). A later change of one does not block:
 -- the cancel subtracts this source's own contribution instead (bank model,
 -- as a reversal). Every other table is owned by the source that wrote the
 -- row. An inactive account or category keeps the strict rule.
 SELECT COALESCE(array_agg(mu.id),'{}') INTO relaxed FROM crypto_source_mutations mu
  WHERE mu.source_event_id=src.id AND mu.revision=src.revision
   AND mu.table_name IN ('current_crypto_balances','current_bank_balances','current_budget_balances')
   AND COALESCE((SELECT a.is_active FROM bank_accounts a WHERE a.id=(mu.row_key->>'bank_account_id')::bigint),
                (SELECT c.is_active FROM categories c WHERE c.id=(mu.row_key->>'category_id')::bigint));
 -- Dependency: any later journal mutation of a row this source owns, even if
 -- it later returned the row to the same values. Also:
 -- - a later spend of the same coin or currency on the same account after
 --   this source spent lots: FIFO of that spend would differ without it;
 -- - a later merge of the coin: the cancel would revive the merged coin.
 SELECT max(id) INTO last_mutation FROM crypto_source_mutations WHERE source_event_id=src.id AND revision=src.revision;
 WITH mine AS (SELECT * FROM crypto_source_mutations WHERE source_event_id=src.id AND revision=src.revision),
 spends AS (
  SELECT c2.operation_id FROM mine JOIN crypto_lots x ON x.id=(mine.after_row->>'lot_id')::bigint
   JOIN crypto_lots y ON y.bank_account_id=x.bank_account_id AND y.crypto_asset_id=x.crypto_asset_id
   JOIN crypto_lot_consumptions c2 ON c2.lot_id=y.id AND c2.id>(mine.row_key->>'id')::bigint
  WHERE mine.table_name='crypto_lot_consumptions' AND mine.before_row IS NULL
   AND NOT EXISTS(SELECT 1 FROM mine m2 WHERE m2.table_name='crypto_lot_consumptions' AND (m2.row_key->>'id')::bigint=c2.id)
  UNION
  SELECT c2.operation_id FROM mine JOIN fx_lots x ON x.id=(mine.after_row->>'lot_id')::bigint
   JOIN fx_lots y ON y.bank_account_id=x.bank_account_id AND y.currency_code=x.currency_code
   JOIN lot_consumptions c2 ON c2.lot_id=y.id AND c2.id>(mine.row_key->>'id')::bigint
  WHERE mine.table_name='lot_consumptions' AND mine.before_row IS NULL
   AND NOT EXISTS(SELECT 1 FROM mine m2 WHERE m2.table_name='lot_consumptions' AND (m2.row_key->>'id')::bigint=c2.id)),
 -- A reversed spend gave its coins back, and the reversal itself is no spend.
 later_spends AS (
  SELECT s.operation_id FROM spends s JOIN operations o ON o.id=s.operation_id
  WHERE o.type<>'reversal' AND NOT EXISTS(SELECT 1 FROM operations r WHERE r.reversal_of_operation_id=o.id)),
 later_events AS (
  SELECT later.source_event_id id FROM mine
  JOIN crypto_source_mutations later ON later.table_name=mine.table_name AND later.row_key=mine.row_key
   AND later.id>last_mutation
  JOIN crypto_source_events e ON e.id=later.source_event_id AND e.revision=later.revision
  WHERE e.id<>src.id AND (NOT mine.id=ANY(relaxed) OR e.commands @> '[{"kind":"bank_asset_merge"}]'::jsonb)
  UNION
  SELECT l.source_event_id FROM later_spends s
  JOIN crypto_source_event_links l ON l.ledger_table='operations' AND l.ledger_id=s.operation_id)
 SELECT string_agg(label,'; ' ORDER BY posted DESC) INTO blockers FROM (
  SELECT e.occurred_at posted, to_char(COALESCE((e.evidence->>'requested_date')::date,e.accounting_date),'DD.MM.YYYY')
   ||' '||COALESCE((SELECT string_agg(c->>'kind',' + ') FROM jsonb_array_elements(e.commands) c),'')
   -- Name the item: several sales on one day read the same otherwise.
   ||COALESCE(' «'||(SELECT string_agg(DISTINCT COALESCE(p.title,c->'payload'->>'title'),'», «')
     FROM jsonb_array_elements(e.commands) c
     LEFT JOIN portfolio_positions p ON c->>'kind' LIKE 'collectible_%'
      AND p.id=COALESCE(c->'payload'->>'source_position_id',c->'payload'->>'position_id')::bigint)||'»','') label
  FROM crypto_source_events e WHERE e.id IN (SELECT id FROM later_events)
  UNION ALL
  -- A spend outside the journal (an ordinary expense in that currency).
  SELECT o.created_at, to_char(o.operated_on,'DD.MM.YYYY')||' '||COALESCE(NULLIF(btrim(o.comment),''),o.type)
  FROM operations o WHERE o.id IN (SELECT operation_id FROM later_spends)
   AND NOT EXISTS(SELECT 1 FROM crypto_source_event_links l WHERE l.ledger_table='operations' AND l.ledger_id=o.id)) b;
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
 -- What a shared balance holds beyond its entries and lots, before the cancel:
 -- the cancel must leave that gap exactly as it was.
 FOR k IN SELECT DISTINCT table_name,row_key FROM crypto_source_mutations WHERE id=ANY(relaxed) LOOP
  gaps:=gaps||jsonb_build_object(k.table_name||k.row_key::text,get__shared_balance_gap(k.table_name,k.row_key));
 END LOOP;
 BEGIN
  -- Exact reverse mutation order; a row changed outside the journal is a conflict.
  FOR m IN SELECT * FROM crypto_source_mutations WHERE source_event_id=src.id AND revision=src.revision
    AND NOT id=ANY(relaxed) ORDER BY id DESC LOOP
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
 -- Shared balances lose this source's contribution, summed over its mutations
 -- (a missing row counts as zeros). Rows in the lock order of the guidelines:
 -- bank balances, budget, coins. Not captured: the source leaves the journal.
 FOR k IN SELECT mu.table_name,mu.row_key,
   sum(COALESCE((mu.after_row->>'amount')::numeric,0)-COALESCE((mu.before_row->>'amount')::numeric,0)) da,
   sum(COALESCE((mu.after_row->>CASE mu.table_name WHEN 'current_crypto_balances' THEN 'cost_base_remaining' ELSE 'historical_cost_in_base' END)::numeric,0)
      -COALESCE((mu.before_row->>CASE mu.table_name WHEN 'current_crypto_balances' THEN 'cost_base_remaining' ELSE 'historical_cost_in_base' END)::numeric,0)) dc
  FROM crypto_source_mutations mu WHERE mu.id=ANY(relaxed)
  GROUP BY mu.table_name,mu.row_key
  ORDER BY mu.table_name,(mu.row_key->>'bank_account_id')::bigint,(mu.row_key->>'category_id')::bigint,
   (mu.row_key->>'crypto_asset_id')::bigint,mu.row_key->>'currency_code' LOOP
  CONTINUE WHEN k.da=0 AND k.dc=0;
  deltas:=deltas||jsonb_build_object('table',k.table_name,'key',k.row_key,'amount',-k.da,'cost',-k.dc);
  IF k.table_name='current_crypto_balances' THEN
   PERFORM 1 FROM current_crypto_balances WHERE bank_account_id=(k.row_key->>'bank_account_id')::bigint
    AND crypto_asset_id=(k.row_key->>'crypto_asset_id')::bigint FOR UPDATE;
   PERFORM put__apply_current_crypto_delta((k.row_key->>'bank_account_id')::bigint,(k.row_key->>'crypto_asset_id')::bigint,-k.da,-k.dc);
   now_amount:=COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id=(k.row_key->>'bank_account_id')::bigint
    AND crypto_asset_id=(k.row_key->>'crypto_asset_id')::bigint),0);
   IF k.da>0 AND now_amount<0 THEN
    SELECT symbol INTO sym FROM crypto_assets WHERE id=(k.row_key->>'crypto_asset_id')::bigint;
    RAISE EXCEPTION 'Не отменить: на счёте «%» не хватает % % — монеты уже потрачены',
     (SELECT name FROM bank_accounts WHERE id=(k.row_key->>'bank_account_id')::bigint),trim_scale(-now_amount),sym;
   END IF;
  ELSIF k.table_name='current_bank_balances' THEN
   PERFORM 1 FROM current_bank_balances WHERE bank_account_id=(k.row_key->>'bank_account_id')::bigint
    AND currency_code=k.row_key->>'currency_code' FOR UPDATE;
   PERFORM put__apply_current_bank_delta((k.row_key->>'bank_account_id')::bigint,(k.row_key->>'currency_code')::char(3),-k.da,-k.dc);
   now_amount:=COALESCE((SELECT amount FROM current_bank_balances WHERE bank_account_id=(k.row_key->>'bank_account_id')::bigint
    AND currency_code=k.row_key->>'currency_code'),0);
   -- The same rules as a reversal (put__reverse_operation).
   SELECT name,account_kind,credit_limit INTO acc FROM bank_accounts WHERE id=(k.row_key->>'bank_account_id')::bigint;
   IF k.da>0 AND acc.account_kind='credit' THEN
    IF acc.credit_limit IS NULL THEN RAISE EXCEPTION 'Не отменить: у кредитной карты «%» не задан лимит',acc.name; END IF;
    IF now_amount<-acc.credit_limit THEN RAISE EXCEPTION 'Не отменить: на кредитной карте «%» будет превышен лимит',acc.name; END IF;
   ELSIF k.da>0 AND now_amount<0 THEN
    RAISE EXCEPTION 'Не отменить: на счёте «%» не хватает % % — деньги уже потрачены',acc.name,round(-now_amount,2),k.row_key->>'currency_code';
   END IF;
  ELSE
   PERFORM 1 FROM current_budget_balances WHERE category_id=(k.row_key->>'category_id')::bigint
    AND currency_code=k.row_key->>'currency_code' FOR UPDATE;
   PERFORM put__apply_current_budget_delta((k.row_key->>'category_id')::bigint,(k.row_key->>'currency_code')::char(3),-k.da);
  END IF;
 END LOOP;
 -- Regular categories may go negative, as after a reversal; the free budget
 -- (Unallocated together with FX Result) must cover what the cancel takes.
 FOR k IN SELECT c.owner_type,c.owner_user_id,c.owner_family_id,d->'key'->>'currency_code' cur,sum((d->>'amount')::numeric) taken
  FROM jsonb_array_elements(deltas) d JOIN categories c ON c.id=(d->'key'->>'category_id')::bigint
  WHERE d->>'table'='current_budget_balances' AND c.kind='system' AND c.name IN ('Unallocated','FX Result')
  GROUP BY 1,2,3,4 HAVING sum((d->>'amount')::numeric)<0 LOOP
  SELECT COALESCE(sum(b.amount),0) INTO free_total FROM current_budget_balances b JOIN categories c ON c.id=b.category_id
   WHERE b.currency_code=k.cur AND c.kind='system' AND c.name IN ('Unallocated','FX Result')
    AND c.owner_type=k.owner_type AND c.owner_user_id IS NOT DISTINCT FROM k.owner_user_id
    AND c.owner_family_id IS NOT DISTINCT FROM k.owner_family_id;
  IF free_total<0 THEN
   RAISE EXCEPTION 'Не отменить: в свободном остатке не хватает % %',round(-free_total,2),k.cur;
  END IF;
 END LOOP;
 -- Guard against a dependency nobody foresaw: entries and balance moved together.
 FOR k IN SELECT key,value FROM jsonb_each(gaps) LOOP
  IF k.value IS DISTINCT FROM (SELECT get__shared_balance_gap(mu.table_name,mu.row_key) FROM crypto_source_mutations mu
    WHERE mu.id=ANY(relaxed) AND mu.table_name||mu.row_key::text=k.key LIMIT 1) THEN
   RAISE EXCEPTION 'Не отменить: остаток счёта не сходится с проводками. Нужна проверка учёта';
  END IF;
 END LOOP;
 PERFORM set_config('budgeting.crypto_source_event_id',COALESCE(old_source,''),true);
 PERFORM set_config('budgeting.crypto_source_command_index',COALESCE(old_index,''),true);
 INSERT INTO crypto_source_deletions(request_id,source_event_id,owner_key,source_namespace,source_id,envelope,mutations,
  revisions,corrections,deleted_by_user_id)
 VALUES(_request_id,src.id,src.owner_key,src.source_namespace,src.source_id,to_jsonb(src)||jsonb_build_object('shared_balance_deltas',deltas),muts,
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
