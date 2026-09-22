DROP FUNCTION IF EXISTS budgeting.put__lending_liquidate;
CREATE FUNCTION budgeting.put__lending_liquidate(
    _user_id bigint, _position_id bigint, _collateral_qty numeric,
    _debt_qty numeric, _external_id text, _operated_at date,
    _interest_qty numeric DEFAULT 0, _collateral_fee_qty numeric DEFAULT 0,
    _settlement_value_in_base numeric DEFAULT NULL, _comment text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _p record;
    _prior record;
    _request jsonb;
    _result jsonb;
    _debt numeric;
    _interest numeric;
    _principal numeric;
    _debt_basis numeric;
    _interest_basis numeric;
    _interest_consumed numeric;
    _debt_consumed numeric;
    _collateral_consumed numeric;
    _fee_basis numeric;
    _id bigint;
    _n numeric;
BEGIN
    SET search_path TO budgeting;
    -- One protocol lock serializes liquidation, borrowing, repayment and close.
    SELECT * INTO _p FROM crypto_protocol_positions WHERE id=_position_id FOR UPDATE;
    IF _p.id IS NULL THEN RAISE EXCEPTION 'Unknown lending position'; END IF;
    IF NOT budgeting.has__owner_access(_user_id,_p.owner_type,_p.owner_user_id,_p.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    FOREACH _n IN ARRAY ARRAY[_collateral_qty,_debt_qty,_interest_qty,_collateral_fee_qty] LOOP
        IF _n IS NULL OR _n::text IN ('NaN','Infinity','-Infinity') OR _n<0
            OR _n<>round(_n,18) THEN
            RAISE EXCEPTION 'Liquidation quantities must be finite, non-negative, with at most 18 decimals';
        END IF;
    END LOOP;
    IF _collateral_qty<=0 OR _debt_qty<=0 OR _interest_qty>_debt_qty
        OR _collateral_fee_qty>_collateral_qty OR NULLIF(btrim(_external_id),'') IS NULL
        OR _operated_at IS NULL THEN
        RAISE EXCEPTION 'Liquidation requires positive collateral and debt, source id and date';
    END IF;
    IF _settlement_value_in_base IS NOT NULL AND (
        _settlement_value_in_base<0 OR _settlement_value_in_base::text IN ('NaN','Infinity','-Infinity')
        OR _settlement_value_in_base<>round(_settlement_value_in_base,2)) THEN
        RAISE EXCEPTION 'Settlement value must be finite, non-negative, with at most 2 decimals';
    END IF;
    -- Keep exact input for conflict detection; fee is INCLUDED in seized collateral.
    _request := jsonb_build_object('collateral_quantity',_collateral_qty,
        'debt_quantity',_debt_qty,'interest_quantity',_interest_qty,
        'collateral_fee_quantity',_collateral_fee_qty,'operated_at',_operated_at,
        'settlement_value_in_base',_settlement_value_in_base,'comment',_comment);
    SELECT * INTO _prior FROM crypto_liability_events
        WHERE protocol_position_id=_position_id AND external_id=_external_id;
    IF _prior.id IS NOT NULL THEN
        IF _prior.event_kind<>'liquidation' OR (_prior.metadata->'request') IS DISTINCT FROM _request THEN
            RAISE EXCEPTION 'Conflicting liquidation with the same external id';
        END IF;
        RETURN (_prior.metadata->'result') || jsonb_build_object('liability_event_id',_prior.id);
    END IF;
    IF _p.status<>'open' OR _p.position_type<>'lending'
        OR (_p.metadata->>'debt_accounting_version') IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Liquidation requires an open version-2 loan';
    END IF;
    IF (_p.metadata->>'basis_quality') IN ('unknown','estimated','invalid')
        OR _p.quantity IS NULL OR _p.current_quantity IS NULL
        OR _p.quantity<>_p.current_quantity THEN
        RAISE EXCEPTION 'Reconcile collateral quantity and cost before liquidation';
    END IF;
    _debt := (_p.metadata->>'borrowed_quantity')::numeric;
    _debt_basis := (_p.metadata->>'debt_cost_basis_in_base')::numeric;
    _interest := COALESCE((_p.metadata->>'debt_interest_quantity')::numeric,0);
    _interest_basis := COALESCE((_p.metadata->>'debt_interest_basis_in_base')::numeric,0);
    FOREACH _n IN ARRAY ARRAY[_debt,_debt_basis,_interest,_interest_basis,_p.quantity,_p.cost_basis_in_base] LOOP
        IF _n IS NULL OR _n<0 OR _n::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Invalid collateral or historical debt state';
        END IF;
    END LOOP;
    _principal := _debt-_interest;
    IF _interest>_debt OR _interest_basis>_debt_basis OR _debt_qty>_debt
        OR _interest_qty>_interest OR _debt_qty-_interest_qty>_principal
        OR _collateral_qty>_p.quantity THEN
        RAISE EXCEPTION 'Liquidation exceeds collateral, principal or accrued interest';
    END IF;
    _interest_consumed := CASE WHEN _interest_qty=0 THEN 0
        WHEN _interest_qty=_interest THEN _interest_basis
        ELSE round(_interest_basis*_interest_qty/_interest,2) END;
    _debt_consumed := _interest_consumed + CASE WHEN _debt_qty=_interest_qty THEN 0
        WHEN _debt_qty-_interest_qty=_principal THEN _debt_basis-_interest_basis
        ELSE round((_debt_basis-_interest_basis)*(_debt_qty-_interest_qty)/_principal,2) END;
    _collateral_consumed := CASE WHEN _collateral_qty=_p.quantity THEN _p.cost_basis_in_base
        ELSE round(_p.cost_basis_in_base*_collateral_qty/_p.quantity,2) END;
    _fee_basis := round(_collateral_consumed*_collateral_fee_qty/_collateral_qty,2);
    _result := jsonb_build_object('protocol_position_id',_position_id,
        'collateral_asset_id',_p.crypto_asset_id,
        'debt_asset_id',(_p.metadata->>'borrowed_crypto_asset_id')::bigint,
        'collateral_quantity',_collateral_qty,'debt_quantity',_debt_qty,
        'collateral_cost_consumed_in_base',_collateral_consumed,
        'debt_basis_released_in_base',_debt_consumed,
        'interest_basis_released_in_base',_interest_consumed,
        'fee_cost_in_base',_fee_basis,
        'realized_before_fee_in_base',_debt_consumed-(_collateral_consumed-_fee_basis),
        'realized_in_base',_debt_consumed-_collateral_consumed,
        'asset_realized_before_fee_in_base',_settlement_value_in_base-(_collateral_consumed-_fee_basis),
        'liability_realized_in_base',_debt_consumed-_settlement_value_in_base);
    -- Interest expense was recognized at accrual. Releasing its liability here
    -- is NOT another expense. Fee is a breakdown of total, not an extra debit.
    UPDATE crypto_protocol_positions SET
        quantity=quantity-_collateral_qty, current_quantity=current_quantity-_collateral_qty,
        cost_basis_in_base=cost_basis_in_base-_collateral_consumed,
        current_value_in_base=CASE WHEN _collateral_qty=quantity THEN 0
            ELSE round(current_value_in_base*(quantity-_collateral_qty)/quantity,2) END,
        metadata=metadata || jsonb_build_object(
            'borrowed_quantity',_debt-_debt_qty,
            'borrowed_value_in_base',_debt_basis-_debt_consumed,
            'debt_cost_basis_in_base',_debt_basis-_debt_consumed,
            'debt_interest_quantity',_interest-_interest_qty,
            'debt_interest_basis_in_base',_interest_basis-_interest_consumed),
        updated_at=current_timestamp
    WHERE id=_position_id;
    -- No spot portfolio_event: collateral has already left the wallet at deposit.
    -- Do not auto-close a position with residual debt/rewards; normal close remains available.
    INSERT INTO crypto_liability_events(protocol_position_id,crypto_asset_id,event_kind,
        event_at,external_id,quantity,debt_basis_change_in_base,interest_quantity,
        interest_basis_change_in_base,settlement_value_in_base,asset_cost_consumed_in_base,
        realized_in_base,metadata,created_by_user_id)
    VALUES (_position_id,(_p.metadata->>'borrowed_crypto_asset_id')::bigint,'liquidation',
        _operated_at,_external_id,-_debt_qty,-_debt_consumed,-_interest_qty,
        -_interest_consumed,_settlement_value_in_base,_collateral_consumed,
        _debt_consumed-_collateral_consumed,jsonb_build_object('request',_request,'result',_result),_user_id)
    RETURNING id INTO _id;
    RETURN _result || jsonb_build_object('liability_event_id',_id);
END
$function$;
