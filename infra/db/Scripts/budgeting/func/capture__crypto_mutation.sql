-- Keep this list explicit: only accounting state, never credentials or global prices.
CREATE OR REPLACE FUNCTION budgeting.capture__crypto_mutation()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
 sid bigint:=NULLIF(current_setting('budgeting.crypto_source_event_id',true),'')::bigint;
 rev integer; rowkey jsonb; v jsonb;
BEGIN
 -- While a deleted source is rolled back, record every removed row: a cascade
 -- into rows the source never created means a later dependency.
 IF current_setting('budgeting.crypto_restoring',true)='on' THEN
   IF TG_OP='DELETE' AND TG_WHEN='AFTER' THEN
     INSERT INTO pg_temp.crypto_restore_deleted(table_name,row_data) VALUES(TG_TABLE_NAME,to_jsonb(OLD));
   END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF sid IS NULL THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT revision INTO rev FROM budgeting.crypto_source_events WHERE id=sid;
 v:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 SELECT jsonb_object_agg(a.attname,v->a.attname) INTO rowkey
 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
 WHERE i.indrelid=TG_RELID AND i.indisprimary;
 IF rowkey IS NULL THEN RAISE EXCEPTION 'Accounting audit requires a primary key'; END IF;
 INSERT INTO budgeting.crypto_source_mutations(source_event_id,revision,command_index,table_name,row_key,before_row,after_row)
 VALUES(sid,rev,current_setting('budgeting.crypto_source_command_index')::integer,TG_TABLE_NAME,rowkey,
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $f$;
DO $install$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['portfolio_positions','portfolio_events','crypto_protocol_positions',
 'crypto_liability_events','crypto_protocol_accrual_events','operations','bank_entries','budget_entries',
 'fx_lots','lot_consumptions','crypto_lots','crypto_lot_consumptions','crypto_bank_entries',
 'current_crypto_balances','current_bank_balances','current_budget_balances','crypto_source_event_links'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS zz_crypto_mutation ON budgeting.%I',t);
 EXECUTE format('CREATE TRIGGER zz_crypto_mutation AFTER INSERT OR UPDATE OR DELETE ON budgeting.%I FOR EACH ROW EXECUTE FUNCTION budgeting.capture__crypto_mutation()',t);
 -- Identity reuse served history replay, which no longer exists.
 EXECUTE format('DROP TRIGGER IF EXISTS aa_crypto_identity ON budgeting.%I',t);
 END LOOP;
END $install$;
