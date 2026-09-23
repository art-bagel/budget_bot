DROP FUNCTION IF EXISTS budgeting.put__lending_accrue;
CREATE FUNCTION budgeting.put__lending_accrue(
    _user_id bigint, _position_id bigint, _collateral_qty numeric,
    _interest_qty numeric, _interest_value_in_base numeric,
    _collateral_before numeric, _debt_before numeric,
    _external_id text, _operated_at date
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _p record;
    _prior record;
    _n numeric;
    _request jsonb;
    _result jsonb;
    _id bigint;
    _liability_id bigint;
    _interest_external text := 'protocol-accrual:' || _external_id;
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM crypto_protocol_positions WHERE id=_position_id AND
        (metadata->>'funding_policy'='components' OR COALESCE(metadata->'funding_units0','{}')<>'{}'::jsonb
            OR COALESCE(metadata->'funding_units1','{}')<>'{}'::jsonb)) THEN
        RAISE EXCEPTION 'Операции с заёмным финансированием проводятся через журнал криптоистории';
    END IF;

    SELECT * INTO _p FROM crypto_protocol_positions WHERE id=_position_id FOR UPDATE;
    IF _p.id IS NULL THEN RAISE EXCEPTION 'Unknown lending position'; END IF;
    IF NOT budgeting.has__owner_access(_user_id,_p.owner_type,_p.owner_user_id,_p.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    FOREACH _n IN ARRAY ARRAY[_collateral_qty,_interest_qty,_collateral_before,_debt_before] LOOP
        IF _n IS NULL OR _n<0 OR _n::text IN ('NaN','Infinity','-Infinity') OR _n<>round(_n,18) THEN
            RAISE EXCEPTION 'Accrual quantities must be finite, non-negative, with at most 18 decimals';
        END IF;
    END LOOP;
    IF _collateral_qty+_interest_qty<=0 OR _collateral_before<=0
        OR NULLIF(btrim(_external_id),'') IS NULL OR _operated_at IS NULL THEN
        RAISE EXCEPTION 'Accrual requires a positive increment, existing collateral, date and source';
    END IF;
    IF (_interest_qty=0 AND COALESCE(_interest_value_in_base,0)<>0)
        OR (_interest_value_in_base IS NOT NULL AND (_interest_value_in_base<0
            OR _interest_value_in_base::text IN ('NaN','Infinity','-Infinity')
            OR _interest_value_in_base<>round(_interest_value_in_base,2))) THEN
        RAISE EXCEPTION 'Interest accrual requires an explicit finite historical valuation';
    END IF;
    _request:=jsonb_build_object('collateral_quantity',_collateral_qty,
        'interest_quantity',_interest_qty,'interest_value_in_base',_interest_value_in_base,
        'collateral_before',_collateral_before,'debt_before',_debt_before,'event_at',_operated_at);
    SELECT * INTO _prior FROM crypto_protocol_accrual_events
        WHERE protocol_position_id=_position_id AND external_id=_external_id;
    IF _prior.id IS NOT NULL THEN
        IF _prior.request IS DISTINCT FROM _request THEN
            RAISE EXCEPTION 'Conflicting accrual with the same external id';
        END IF;
        RETURN _prior.result || jsonb_build_object('accrual_event_id',_prior.id);
    END IF;
    IF _p.status<>'open' OR _p.position_type<>'lending' THEN
        RAISE EXCEPTION 'Accrual requires an open lending position';
    END IF;
    IF _p.quantity IS DISTINCT FROM _collateral_before
        OR _p.current_quantity IS DISTINCT FROM _collateral_before
        OR COALESCE((_p.metadata->>'borrowed_quantity')::numeric,0)<>_debt_before THEN
        RAISE EXCEPTION 'Accrual opening quantities do not match; replay preceding events first';
    END IF;
    IF (_p.metadata->>'basis_quality')='invalid'
        OR _p.cost_basis_in_base<0
        OR _p.cost_basis_in_base::text IN ('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'Invalid collateral basis; reconstruct the source ledger';
    END IF;
    -- Do not accept an existing separately-created interest event as a new
    -- combined accrual: its opening-state assertion and collateral leg differ.
    IF EXISTS(SELECT 1 FROM crypto_liability_events WHERE protocol_position_id=_position_id
        AND external_id=_interest_external) THEN
        RAISE EXCEPTION 'Accrual interest source is already used outside this event';
    END IF;
    IF _interest_qty>0 THEN
        PERFORM budgeting.put__lending_accrue_interest(_user_id,_position_id,
            _interest_qty,_interest_value_in_base,_interest_external,_operated_at);
        SELECT id INTO _liability_id FROM crypto_liability_events
            WHERE protocol_position_id=_position_id AND external_id=_interest_external;
    END IF;
    -- Free yield increases units, not acquisition expenditure. Do not create a
    -- spot transfer: the extra units are still collateral inside the protocol.
    UPDATE crypto_protocol_positions SET quantity=quantity+_collateral_qty,
        current_quantity=current_quantity+_collateral_qty,
        updated_at=current_timestamp WHERE id=_position_id;
    _result:=jsonb_build_object('protocol_position_id',_position_id,
        'collateral_before',_collateral_before,'collateral_after',_collateral_before+_collateral_qty,
        'debt_before',_debt_before,'debt_after',_debt_before+_interest_qty,
        'collateral_cost_added_in_base',0,'interest_expense_in_base',
            CASE WHEN _interest_qty=0 THEN 0 ELSE _interest_value_in_base END,
        'liability_event_id',_liability_id);
    INSERT INTO crypto_protocol_accrual_events(protocol_position_id,external_id,event_at,
        collateral_quantity,interest_quantity,liability_event_id,request,result,created_by_user_id)
    VALUES(_position_id,_external_id,_operated_at,_collateral_qty,_interest_qty,
        _liability_id,_request,_result,_user_id) RETURNING id INTO _id;
    RETURN _result || jsonb_build_object('accrual_event_id',_id);
END
$function$;
