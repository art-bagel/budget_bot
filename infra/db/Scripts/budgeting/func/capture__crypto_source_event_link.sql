-- CREATE OR REPLACE preserves existing trigger dependencies on upgrades.
CREATE OR REPLACE FUNCTION budgeting.capture__crypto_source_event_link()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    _source_id bigint := NULLIF(current_setting('budgeting.crypto_source_event_id',true),'')::bigint;
BEGIN
    IF _source_id IS NOT NULL THEN
        INSERT INTO budgeting.crypto_source_event_links(source_event_id,command_index,ledger_table,ledger_id)
        VALUES(_source_id,current_setting('budgeting.crypto_source_command_index')::integer,TG_TABLE_NAME,NEW.id);
    END IF;
    RETURN NEW;
END
$function$;

DO $install$
DECLARE _table text;
BEGIN
    FOREACH _table IN ARRAY ARRAY['operations','portfolio_events','crypto_liability_events','crypto_protocol_accrual_events'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS capture_crypto_source ON budgeting.%I',_table);
        EXECUTE format('CREATE TRIGGER capture_crypto_source AFTER INSERT ON budgeting.%I FOR EACH ROW EXECUTE FUNCTION budgeting.capture__crypto_source_event_link()',_table);
    END LOOP;
END
$install$;
