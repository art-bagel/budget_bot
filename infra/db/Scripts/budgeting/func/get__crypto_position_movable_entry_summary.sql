DROP FUNCTION IF EXISTS budgeting.get__crypto_position_movable_entry_summary;
CREATE FUNCTION budgeting.get__crypto_position_movable_entry_summary(_position_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE _s jsonb;
BEGIN
    _s:=budgeting.get__crypto_position_entry_summary(_position_id);
    IF _s->>'basis_quality'='invalid' THEN
        RAISE EXCEPTION 'Invalid cost ledger for position %; reconstruct source events',_position_id;
    END IF;
    IF COALESCE(_s->'funding_units','{}')<>'{}'::jsonb
       AND NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
        RAISE EXCEPTION 'Операции с заёмным финансированием проводятся через журнал криптоистории';
    END IF;
    RETURN _s;
END
$function$;
