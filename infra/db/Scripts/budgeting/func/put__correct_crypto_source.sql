CREATE OR REPLACE FUNCTION budgeting.put__correct_crypto_source(
 _user_id bigint,_source_event_id bigint,_expected_revision integer,_request_id uuid,
 _changes jsonb,_reason text,_apply boolean DEFAULT false,_preview_token text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
 src record; rec record; m record; cmd jsonb; cmds jsonb; change jsonb; idx integer; field text;
 n numeric; assigns text; actual jsonb; report jsonb; before_state jsonb; after_state jsonb;
 token text; req jsonb; prior record; ids bigint[]; t text; old_source text; old_index text; predicate text;
BEGIN
 SET search_path TO budgeting;
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id;
 IF src.id IS NULL OR NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=src.anchor_account_id
  AND has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)) THEN
  RAISE EXCEPTION 'Нет доступа к исправляемой операции';
 END IF;
 IF _request_id IS NULL OR NULLIF(btrim(_reason),'') IS NULL OR length(_reason)>1000
  OR jsonb_typeof(_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(_changes) NOT BETWEEN 1 AND 30 THEN
  RAISE EXCEPTION 'Укажите изменения и причину исправления';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||src.owner_key,0));
 SELECT * INTO src FROM crypto_source_events WHERE id=_source_event_id FOR UPDATE;
 req:=jsonb_build_object('source',_source_event_id,'revision',_expected_revision,'changes',_changes,'reason',_reason);
 SELECT * INTO prior FROM crypto_source_corrections WHERE request_id=_request_id;
 IF prior.request_id IS NOT NULL THEN
  IF prior.request IS DISTINCT FROM req OR prior.actor_user_id<>_user_id THEN
   RAISE EXCEPTION 'Этот запрос исправления уже использован с другими данными';
  END IF;
  RETURN prior.result;
 END IF;
 IF src.revision<>_expected_revision THEN RAISE EXCEPTION 'Операция уже исправлена. Обновите историю'; END IF;
 SELECT array_agg(id ORDER BY occurred_at,order_in_timestamp) INTO ids FROM crypto_source_events
 WHERE owner_key=src.owner_key AND (occurred_at,order_in_timestamp)>=(src.occurred_at,src.order_in_timestamp);
 IF EXISTS(SELECT 1 FROM crypto_source_events WHERE id=ANY(ids) AND NOT reversible) THEN
  RAISE EXCEPTION 'У этой старой цепочки ещё нет проверенного снимка для пересчёта. Исходная история сохранена';
 END IF;
 cmds:=src.commands;
 FOR change IN SELECT value FROM jsonb_array_elements(_changes) LOOP
  idx:=(change->>'command_index')::integer; field:=change->>'field';
  IF idx IS NULL OR idx<0 OR idx>=jsonb_array_length(cmds) OR field IS NULL
   OR field NOT IN ('from_amount','to_amount','quantity','amount','debt_qty','interest_qty','collateral_qty',
    'collateral_fee_qty','principal_qty','secondary_principal_qty','rewards_qty','secondary_rewards_qty',
    'return_quantity','secondary_return_quantity','secondary_quantity','fiat_amount','repay_qty','crypto_quantity','amount_in_currency','close_amount_in_currency')
   OR jsonb_typeof(change->'value') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Можно исправлять только количества и сумму покупки, без изменения счетов и вида операции';
  END IF;
  cmd:=cmds->idx;
  IF NOT field=ANY(budgeting.get__crypto_correction_fields(cmd->>'kind')) THEN
   RAISE EXCEPTION 'Это поле не редактируется для данного вида операции';
  END IF;
  IF NOT (cmd->'payload' ? field) THEN RAISE EXCEPTION 'Этого поля нет в исходной операции'; END IF;
  n:=(change->>'value')::numeric;
  IF n<0 OR n::text IN ('NaN','Infinity','-Infinity') OR n<>round(n,18) THEN RAISE EXCEPTION 'Количество должно быть неотрицательным и точным до 18 знаков'; END IF;
  cmds:=jsonb_set(cmds,ARRAY[idx::text,'payload',field],change->'value');
 END LOOP;
 IF cmds=src.commands THEN RAISE EXCEPTION 'Нет изменений для пересчёта'; END IF;
 -- Ordinary bank writers do not take the journal advisory lock. Serialize the
 -- short correction against all accounting writes, in one fixed table order.
 FOREACH t IN ARRAY ARRAY['bank_accounts','portfolio_positions','portfolio_events','crypto_protocol_positions',
 'crypto_liability_events','crypto_protocol_accrual_events','operations','bank_entries','budget_entries',
 'fx_lots','lot_consumptions','crypto_lots','crypto_lot_consumptions','crypto_bank_entries',
 'current_crypto_balances','current_bank_balances','current_budget_balances','crypto_source_event_links'] LOOP
 EXECUTE format('LOCK TABLE budgeting.%I IN SHARE ROW EXCLUSIVE MODE',t);
 END LOOP;
 -- Preserve chronological FIFO against non-journal bank/other operation tails.
 IF EXISTS(SELECT 1 FROM operations o WHERE
   o.owner_type=(SELECT owner_type FROM bank_accounts WHERE id=src.anchor_account_id)
   AND o.owner_user_id IS NOT DISTINCT FROM (SELECT owner_user_id FROM bank_accounts WHERE id=src.anchor_account_id)
   AND o.owner_family_id IS NOT DISTINCT FROM (SELECT owner_family_id FROM bank_accounts WHERE id=src.anchor_account_id)
   AND o.id>COALESCE((SELECT min(ledger_id) FROM crypto_source_event_links WHERE source_event_id=ANY(ids) AND ledger_table='operations'),9223372036854775807)
   AND NOT EXISTS(SELECT 1 FROM crypto_source_event_links l WHERE l.ledger_table='operations' AND l.ledger_id=o.id)) THEN
   RAISE EXCEPTION 'После этой цепочки есть операции вне журнала. Пересчёт остановлен без потери данных';
 END IF;
 -- Cost-only events may not update their position row; exclude nonjournal tails.
 IF EXISTS(SELECT 1 FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
   JOIN bank_accounts a ON a.id=p.investment_account_id
   WHERE a.owner_type=(SELECT owner_type FROM bank_accounts WHERE id=src.anchor_account_id)
    AND a.owner_user_id IS NOT DISTINCT FROM (SELECT owner_user_id FROM bank_accounts WHERE id=src.anchor_account_id)
    AND a.owner_family_id IS NOT DISTINCT FROM (SELECT owner_family_id FROM bank_accounts WHERE id=src.anchor_account_id)
    AND p.asset_type_code='crypto'
    AND e.id>COALESCE((SELECT min(ledger_id) FROM crypto_source_event_links WHERE source_event_id=ANY(ids) AND ledger_table='portfolio_events'),9223372036854775807)
    AND NOT EXISTS(SELECT 1 FROM crypto_source_event_links l WHERE l.ledger_table='portfolio_events' AND l.ledger_id=e.id)) THEN
   RAISE EXCEPTION 'После этой цепочки есть операции вне журнала. Пересчёт остановлен без потери данных';
 END IF;
 -- This token covers every current affected row and all source revisions. An
 -- unrelated new source invalidates the preview too; no stale confirmation.
 SELECT md5(req::text||COALESCE(string_agg(to_jsonb(e)::text,'' ORDER BY occurred_at,order_in_timestamp),''))
 INTO token FROM crypto_source_events e WHERE owner_key=src.owner_key;
 before_state:=budgeting.get__crypto_correction_state(src.anchor_account_id);
 token:=md5(token||before_state::text);
 IF _apply AND (_preview_token IS NULL OR _preview_token<>token) THEN
  RAISE EXCEPTION 'Результат изменился после просмотра. Выполните предварительный пересчёт ещё раз';
 END IF;
 old_source:=current_setting('budgeting.crypto_source_event_id',true);
 old_index:=current_setting('budgeting.crypto_source_command_index',true);
 BEGIN
  CREATE TEMP TABLE IF NOT EXISTS crypto_replay_identity (LIKE budgeting.crypto_source_mutations INCLUDING DEFAULTS) ON COMMIT DROP;
  ALTER TABLE pg_temp.crypto_replay_identity ADD COLUMN IF NOT EXISTS used boolean NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS crypto_replay_identity_slot ON pg_temp.crypto_replay_identity(id);
  CREATE INDEX IF NOT EXISTS crypto_replay_identity_pending ON pg_temp.crypto_replay_identity
   (source_event_id,command_index,table_name,id) WHERE NOT used;
  TRUNCATE pg_temp.crypto_replay_identity;
  INSERT INTO pg_temp.crypto_replay_identity(id,source_event_id,revision,command_index,table_name,row_key,before_row,after_row)
   SELECT mu.* FROM crypto_source_mutations mu JOIN crypto_source_events e ON e.id=mu.source_event_id AND e.revision=mu.revision
   WHERE e.id=ANY(ids) AND mu.before_row IS NULL AND mu.after_row ? 'id';
  PERFORM set_config('budgeting.crypto_restoring','on',true);
  PERFORM set_config('budgeting.crypto_source_event_id','',true);
  -- Restore only rows touched by the suffix, in exact reverse mutation order.
  -- Any later non-journal edit is a conflict, never silently overwritten.
  FOR m IN SELECT mu.* FROM crypto_source_mutations mu JOIN crypto_source_events e
   ON e.id=mu.source_event_id AND e.revision=mu.revision WHERE e.id=ANY(ids) ORDER BY mu.id DESC LOOP
   -- Match typed primary-key columns so PostgreSQL can use the PK index.
   -- JSON containment here scanned the complete ledger for every mutation.
   SELECT string_agg(format('t.%I=k.%I',key,key),' AND ' ORDER BY key)
    INTO predicate FROM jsonb_object_keys(m.row_key) key;
   EXECUTE format('SELECT to_jsonb(t) FROM budgeting.%I t, jsonb_populate_record(NULL::budgeting.%I,$1) k WHERE %s',
    m.table_name,m.table_name,predicate) INTO actual USING m.row_key;
   IF actual IS DISTINCT FROM m.after_row THEN
    RAISE EXCEPTION 'После этой цепочки есть изменения вне журнала (%). Пересчёт остановлен без потери расходов и категорий',m.table_name;
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
  PERFORM set_config('budgeting.crypto_restoring','off',true);
  PERFORM set_config('budgeting.crypto_replaying','on',true);
  FOR rec IN SELECT * FROM crypto_source_events WHERE id=ANY(ids) ORDER BY occurred_at,order_in_timestamp LOOP
   INSERT INTO crypto_source_revisions(source_event_id,revision,envelope) VALUES(rec.id,rec.revision,to_jsonb(rec));
   UPDATE crypto_source_events SET revision=revision+1,
    commands=CASE WHEN id=src.id THEN cmds ELSE commands END WHERE id=rec.id;
   PERFORM set_config('budgeting.crypto_replay_source',rec.id::text,true);
   PERFORM put__crypto_source_event(rec.created_by_user_id,rec.anchor_account_id,rec.source_namespace,rec.source_id,
    rec.occurred_at,rec.order_in_timestamp,rec.accounting_date,CASE WHEN rec.id=src.id THEN cmds ELSE rec.commands END,rec.evidence);
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_temp.crypto_replay_identity WHERE NOT used) THEN
   RAISE EXCEPTION 'Исправление меняет структуру проводок; автоматический пересчёт остановлен';
  END IF;
  PERFORM set_config('budgeting.crypto_replaying','off',true);
  PERFORM set_config('budgeting.crypto_replay_source','',true);
  PERFORM set_config('budgeting.crypto_source_event_id',COALESCE(old_source,''),true);
  PERFORM set_config('budgeting.crypto_source_command_index',COALESCE(old_index,''),true);
  after_state:=budgeting.get__crypto_correction_state(src.anchor_account_id);
  report:=jsonb_build_object('source_event_id',src.id,'revision',src.revision+1,'replayed_sources',cardinality(ids),
   'preview_token',token,'applied',_apply,'before',before_state,'after',after_state);
  IF NOT _apply THEN RAISE EXCEPTION USING ERRCODE='ZC001', MESSAGE='preview rollback'; END IF;
  INSERT INTO crypto_source_corrections(request_id,source_event_id,actor_user_id,reason,request,result)
   VALUES(_request_id,src.id,_user_id,_reason,req,report);
 EXCEPTION WHEN SQLSTATE 'ZC001' THEN NULL;
 END;
 RETURN report;
END $f$;
