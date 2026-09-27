DROP FUNCTION IF EXISTS budgeting.put__lending_liquidate;
CREATE FUNCTION budgeting.put__lending_liquidate(
    _user_id bigint, _position_id bigint, _collateral_qty numeric,
    _debt_qty numeric, _external_id text, _operated_at date,
    _interest_qty numeric DEFAULT 0, _collateral_fee_qty numeric DEFAULT 0,
    _settlement_value_in_base numeric DEFAULT NULL, _comment text DEFAULT NULL,
    _collateral_position_id bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _p record;
    _c record;
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
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM crypto_protocol_positions WHERE id=_position_id AND
        (metadata->>'funding_policy'='components' OR COALESCE(metadata->'funding_units0','{}')<>'{}'::jsonb
            OR COALESCE(metadata->'funding_units1','{}')<>'{}'::jsonb)) THEN
        RAISE EXCEPTION 'Операции с заёмным финансированием проводятся через журнал криптоистории';
    END IF;

    -- One protocol lock serializes liquidation, borrowing, repayment and close.
    SELECT * INTO _p FROM crypto_protocol_positions WHERE id=_position_id FOR UPDATE;
    IF _p.id IS NULL THEN RAISE EXCEPTION 'Unknown lending position'; END IF;
    IF NOT budgeting.has__owner_access(_user_id,_p.owner_type,_p.owner_user_id,_p.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    _collateral_position_id:=COALESCE(_collateral_position_id,_position_id);
    SELECT * INTO _c FROM crypto_protocol_positions WHERE id=_collateral_position_id FOR UPDATE;
    IF _c.id IS NULL OR NOT budgeting.has__owner_access(_user_id,_c.owner_type,_c.owner_user_id,_c.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к залогу';
    END IF;
    IF _collateral_position_id<>_position_id AND (
        NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL
        OR _p.investment_account_id<>_c.investment_account_id
        OR _p.network_code IS DISTINCT FROM _c.network_code
        OR NULLIF(_p.metadata->>'lending_account_key','') IS NULL
        OR _p.metadata->>'lending_account_key' IS DISTINCT FROM _c.metadata->>'lending_account_key'
        OR _c.status<>'open' OR _c.position_type<>'lending') THEN
        RAISE EXCEPTION 'Залог и долг должны принадлежать одному подтверждённому lending-счёту';
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
    IF _collateral_position_id<>_position_id THEN
        _request:=_request||jsonb_build_object('collateral_position_id',_collateral_position_id);
    END IF;
    -- Explicit field for new commands; preserve the interpretation of old envelopes.
    SELECT CASE
        WHEN (s.commands->COALESCE(NULLIF(current_setting('budgeting.crypto_source_command_index',true),'')::integer,0)->'payload') ? 'collateral_fee_known'
        THEN _request || jsonb_build_object('collateral_fee_known',
            (s.commands->COALESCE(NULLIF(current_setting('budgeting.crypto_source_command_index',true),'')::integer,0)->'payload'->>'collateral_fee_known')::boolean)
        WHEN s.source_namespace='manual-portfolio-v1' THEN _request||jsonb_build_object('collateral_fee_known',true)
        ELSE _request END INTO _request
        FROM crypto_source_events s WHERE id=NULLIF(current_setting('budgeting.crypto_source_event_id',true),'')::bigint;
    IF _request IS NULL THEN
        _request:=jsonb_build_object('collateral_quantity',_collateral_qty,'debt_quantity',_debt_qty,
            'interest_quantity',_interest_qty,'collateral_fee_quantity',_collateral_fee_qty,
            'operated_at',_operated_at,'settlement_value_in_base',_settlement_value_in_base,'comment',_comment);
    END IF;
    IF _request->>'collateral_fee_known'='false' AND _collateral_fee_qty<>0 THEN
        RAISE EXCEPTION 'При неизвестном штрафе не указывайте выдуманное количество';
    END IF;
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
    IF (_c.metadata->>'basis_quality')='invalid'
        OR ((_c.metadata->>'basis_quality')='estimated' AND NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL)
        OR _c.quantity IS NULL OR _c.current_quantity IS NULL
        OR _c.quantity<>_c.current_quantity THEN
        RAISE EXCEPTION 'Reconcile collateral quantity and cost before liquidation';
    END IF;
    PERFORM budgeting.check__crypto_lending_state(_p.metadata);
    IF _c.metadata->>'basis_quality'='unknown' THEN _c.cost_basis_in_base:=NULL; END IF;
    _debt := (_p.metadata->>'borrowed_quantity')::numeric;
    _debt_basis := (_p.metadata->>'debt_cost_basis_in_base')::numeric;
    _interest := COALESCE((_p.metadata->>'debt_interest_quantity')::numeric,0);
    _interest_basis := CASE WHEN _interest=0 THEN 0 ELSE (_p.metadata->>'debt_interest_basis_in_base')::numeric END;
    FOREACH _n IN ARRAY ARRAY[_debt,_interest,_c.quantity] LOOP
        IF _n IS NULL OR _n<0 OR _n::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Invalid collateral or historical debt state';
        END IF;
    END LOOP;
    IF _c.cost_basis_in_base<0 OR _c.cost_basis_in_base::text IN ('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'Invalid collateral basis';
    END IF;
    _principal := _debt-_interest;
    IF _interest>_debt OR _interest_basis>_debt_basis OR _debt_qty>_debt
        OR _interest_qty>_interest OR _debt_qty-_interest_qty>_principal
        OR _collateral_qty>_c.quantity THEN
        RAISE EXCEPTION 'Liquidation exceeds collateral, principal or accrued interest';
    END IF;
    _interest_consumed := CASE WHEN _interest_qty=0 THEN 0
        WHEN _interest_qty=_interest THEN _interest_basis
        ELSE round(_interest_basis*_interest_qty/_interest,2) END;
    _debt_consumed := _interest_consumed + CASE WHEN _debt_qty=_interest_qty THEN 0
        WHEN _debt_qty-_interest_qty=_principal THEN _debt_basis-_interest_basis
        ELSE round((_debt_basis-_interest_basis)*(_debt_qty-_interest_qty)/_principal,2) END;
    _collateral_consumed := CASE WHEN _collateral_qty=_c.quantity THEN _c.cost_basis_in_base
        ELSE round(_c.cost_basis_in_base*_collateral_qty/_c.quantity,2) END;
    _fee_basis := CASE WHEN _collateral_fee_qty=0 THEN 0 ELSE round(_collateral_consumed*_collateral_fee_qty/_collateral_qty,2) END;
    _result := jsonb_build_object('protocol_position_id',_position_id,
        'collateral_asset_id',_c.crypto_asset_id,
        'collateral_position_id',_collateral_position_id,
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
    IF _p.metadata->>'funding_policy'='components' THEN
        -- The journal redistributes principal cost to funding holders and
        -- separates financing expenses. Seized cost is not realized loss.
        _result:=_result||jsonb_build_object('realized_before_fee_in_base',0,
            'realized_in_base',0,'asset_realized_before_fee_in_base',NULL,
            'liability_realized_in_base',NULL,'funding_policy','components');
    END IF;
    -- Interest expense was recognized at accrual. Releasing its liability here
    -- is NOT another expense. Fee is a breakdown of total, not an extra debit.
    UPDATE crypto_protocol_positions SET
        quantity=quantity-_collateral_qty, current_quantity=current_quantity-_collateral_qty,
        cost_basis_in_base=CASE WHEN quantity=_collateral_qty THEN 0 ELSE _c.cost_basis_in_base-_collateral_consumed END,
        current_value_in_base=CASE WHEN _collateral_qty=quantity THEN 0
            ELSE round(current_value_in_base*(quantity-_collateral_qty)/quantity,2) END,
        updated_at=current_timestamp
    WHERE id=_collateral_position_id;
    UPDATE crypto_protocol_positions SET
        metadata=metadata || jsonb_build_object(
            'borrowed_quantity',_debt-_debt_qty,
            'borrowed_value_in_base',CASE WHEN _debt=_debt_qty THEN 0 ELSE _debt_basis-_debt_consumed END,
            'debt_cost_basis_in_base',CASE WHEN _debt=_debt_qty THEN 0 ELSE _debt_basis-_debt_consumed END,
            'debt_interest_quantity',_interest-_interest_qty,
            'debt_interest_basis_in_base',CASE WHEN _interest=_interest_qty THEN 0 ELSE _interest_basis-_interest_consumed END,
            'debt_basis_quality',CASE WHEN _debt=_debt_qty OR _debt_basis-_debt_consumed IS NOT NULL THEN 'known' ELSE 'unknown' END),
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
