DROP FUNCTION IF EXISTS budgeting.get__crypto_position_entry_summary;
CREATE FUNCTION budgeting.get__crypto_position_entry_summary(_position_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _entry numeric := 0; _consumed numeric := 0;
    _qty numeric(50,18); _cost numeric; _avg numeric;
    _missing integer := 0; _invalid integer := 0; _entries integer := 0;
    _asset_quality text;
    _funding jsonb;
    _components jsonb;
    _estimated boolean := false; _quality text; _declared text;
    _e record; _field text; _raw text; _value numeric;
BEGIN
    SET search_path TO budgeting;
    SELECT quantity, metadata->>'basis_quality' INTO _qty,_declared
        FROM portfolio_positions WHERE id=_position_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown portfolio position %',_position_id; END IF;
    IF _declared='unknown' THEN _missing:=1;
    ELSIF _declared='invalid' THEN _invalid:=1;
    ELSIF _declared='estimated' THEN _estimated:=true; END IF;
    SELECT ca.metadata->>'reconstruction_basis_quality' INTO _asset_quality
        FROM crypto_assets ca JOIN portfolio_positions pp
          ON ca.id::text=pp.metadata->>'crypto_asset_id' WHERE pp.id=_position_id;
    IF _asset_quality='unknown' THEN _missing:=_missing+1;
    ELSIF _asset_quality='invalid' THEN _invalid:=_invalid+1;
    ELSIF _asset_quality='estimated' THEN _estimated:=true; END IF;
    FOR _e IN SELECT event_type,metadata FROM portfolio_events
        WHERE position_id=_position_id AND event_type IN
        ('open','top_up','transfer_in','swap_in','income','close','partial_close','transfer_out','swap_out','fee')
    LOOP
        IF _e.event_type IN ('open','top_up','transfer_in','swap_in','income') THEN
            _field:='entry_value_in_base'; _entries:=_entries+1;
        ELSE _field:='consumed_cost_basis'; END IF;
        IF _e.metadata->>'basis_quality'='unknown' THEN _missing:=_missing+1;
        ELSIF _e.metadata->>'basis_quality'='estimated' THEN _estimated:=true;
        ELSIF _e.metadata->>'basis_quality'='invalid' THEN _invalid:=_invalid+1; END IF;
        _raw:=_e.metadata->>_field;
        IF _raw IS NULL THEN _missing:=_missing+1; CONTINUE; END IF;
        IF _raw !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN
            _invalid:=_invalid+1; CONTINUE;
        END IF;
        _value:=_raw::numeric;
        IF _value<0 OR (_e.metadata->>'basis_quality'='confirmed_zero' AND _value<>0) THEN
            _invalid:=_invalid+1; CONTINUE;
        END IF;
        IF _field='entry_value_in_base' THEN _entry:=_entry+_value;
        ELSE _consumed:=_consumed+_value; END IF;
    END LOOP;
    IF _qty IS NULL OR _qty<0 OR _qty::text IN ('NaN','Infinity','-Infinity') THEN _invalid:=_invalid+1; END IF;
    IF _qty>0 AND _entries=0 THEN _missing:=_missing+1; END IF;
    IF _missing=0 AND _entry<_consumed THEN _invalid:=_invalid+1; END IF;
    _quality:=CASE WHEN _invalid>0 THEN 'invalid' WHEN _missing>0 THEN 'unknown'
        WHEN _estimated THEN 'estimated' WHEN _entry=0 AND _consumed=0 THEN 'confirmed_zero' ELSE 'known' END;
    IF _quality IN ('known','confirmed_zero','estimated') THEN
        _cost:=_entry-_consumed;
        _avg:=CASE WHEN _qty>0 THEN _cost/_qty ELSE 0 END;
    END IF;
    SELECT COALESCE(metadata->'funding_units','{}'::jsonb) INTO _funding FROM portfolio_positions WHERE id=_position_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('loan_id',f.key,'quantity',f.value,
        'symbol',COALESCE(a.symbol,p.metadata->>'borrowed_asset_symbol','?'))),'[]') INTO _components
        FROM jsonb_each_text(_funding) f JOIN crypto_protocol_positions p ON p.id=f.key::bigint
        LEFT JOIN crypto_assets a ON a.id=(p.metadata->>'borrowed_crypto_asset_id')::bigint;
    RETURN jsonb_build_object(
        'funding_components',_components,
        'funding_units',_funding,'basis_final',_funding='{}'::jsonb,
        'basis_quality',_quality,'missing_cost_fields',_missing,'invalid_cost_fields',_invalid,
        'total_entry_value_in_base',CASE WHEN _quality IN ('unknown','invalid') THEN NULL ELSE _entry END,
        'total_consumed_cost_basis',CASE WHEN _quality IN ('unknown','invalid') THEN NULL ELSE _consumed END,
        'remaining_cost_basis',_cost,'quantity_now',_qty,'avg_cost_per_unit',_avg);
END
$function$;
