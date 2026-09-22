DROP FUNCTION IF EXISTS budgeting.put__lending_accrue_interest;
CREATE FUNCTION budgeting.put__lending_accrue_interest(
    _user_id bigint, _position_id bigint, _quantity numeric,
    _value_in_base numeric, _external_id text, _operated_at date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _p record;
    _prior record;
    _q numeric(50,18);
    _v numeric(20,2);
    _date date := COALESCE(_operated_at, current_date);
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO _p FROM crypto_protocol_positions WHERE id=_position_id FOR UPDATE;
    IF _p.id IS NULL THEN RAISE EXCEPTION 'Unknown lending position'; END IF;
    IF NOT budgeting.has__owner_access(_user_id,_p.owner_type,_p.owner_user_id,_p.owner_family_id)
        THEN RAISE EXCEPTION 'Access denied'; END IF;
    IF _quantity IS NULL OR _quantity <= 0 OR _quantity::text IN ('NaN','Infinity','-Infinity')
        OR _quantity<>round(_quantity,18)
        OR _value_in_base < 0
        OR _value_in_base::text IN ('NaN','Infinity','-Infinity')
        OR NULLIF(btrim(_external_id),'') IS NULL THEN
        RAISE EXCEPTION 'Interest requires a positive quantity, valuation and external id';
    END IF;
    _q := round(_quantity,18); _v := round(_value_in_base,2);
    IF _q <= 0 THEN RAISE EXCEPTION 'Interest is below supported precision'; END IF;
    SELECT * INTO _prior FROM crypto_liability_events
        WHERE protocol_position_id=_position_id AND external_id=_external_id;
    IF _prior.id IS NOT NULL THEN
        IF _prior.event_kind <> 'interest_accrual' OR _prior.quantity <> _q
            OR _prior.debt_basis_change_in_base IS DISTINCT FROM _v OR _prior.event_at <> _date THEN
            RAISE EXCEPTION 'Conflicting interest event with the same external id';
        END IF;
    ELSE
        IF _p.status <> 'open' OR _p.position_type <> 'lending'
            OR (_p.metadata->>'debt_accounting_version') IS DISTINCT FROM '2'
            OR COALESCE((_p.metadata->>'borrowed_quantity')::numeric,0) <= 0 THEN
            RAISE EXCEPTION 'Interest requires an open version-2 loan';
        END IF;
        PERFORM budgeting.check__crypto_lending_state(_p.metadata);
        INSERT INTO crypto_liability_events(protocol_position_id,crypto_asset_id,
            event_kind,event_at,external_id,quantity,debt_basis_change_in_base,
            settlement_value_in_base,interest_quantity,interest_basis_change_in_base,
            realized_in_base,created_by_user_id)
        VALUES (_position_id,(_p.metadata->>'borrowed_crypto_asset_id')::bigint,
            'interest_accrual',_date,_external_id,_q,_v,_v,_q,_v,-_v,_user_id);
        UPDATE crypto_protocol_positions SET metadata=metadata || jsonb_build_object(
            'borrowed_quantity',(_p.metadata->>'borrowed_quantity')::numeric+_q,
            'debt_cost_basis_in_base',(_p.metadata->>'debt_cost_basis_in_base')::numeric+_v,
            'borrowed_value_in_base',(_p.metadata->>'debt_cost_basis_in_base')::numeric+_v,
            'debt_interest_quantity',COALESCE((_p.metadata->>'debt_interest_quantity')::numeric,0)+_q,
            'debt_interest_basis_in_base',CASE WHEN COALESCE((_p.metadata->>'debt_interest_quantity')::numeric,0)=0 THEN _v ELSE (_p.metadata->>'debt_interest_basis_in_base')::numeric+_v END,
            'debt_basis_quality',CASE WHEN (_p.metadata->>'debt_cost_basis_in_base')::numeric+_v IS NULL THEN 'unknown' ELSE 'known' END
        ), updated_at=current_timestamp WHERE id=_position_id;
    END IF;
    RETURN (SELECT item FROM jsonb_array_elements(
        budgeting.get__crypto_protocol_positions(_user_id,_p.investment_account_id,NULL)) item
        WHERE (item->>'id')::bigint=_position_id);
END
$function$;
