-- Called only inside the owner-locked source journal, after one command.
DROP FUNCTION IF EXISTS budgeting.put__crypto_funding_components;
CREATE FUNCTION budgeting.put__crypto_funding_components(_uid bigint,_sid bigint,_idx integer,
    _kind text,_p jsonb,_before jsonb,_result jsonb,_day date)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
    _e record; _h record; _loan text; _map jsonb; _moved jsonb:='{}';
    _out jsonb:='{}'; _old jsonb; _pid bigint; _q numeric; _a jsonb; _b jsonb;
    _a0 jsonb; _b0 jsonb; _pa numeric; _pb numeric; _ra numeric; _rb numeric;
    _settle numeric; _self numeric; _body numeric; _cash numeric; _interest numeric;
    _total numeric; _left_units numeric; _left_cash numeric; _units numeric;
    _take numeric; _cost numeric; _units_after numeric; _expense_id bigint;
    _operation bigint; _fx bigint; _unallocated bigint; _base char(3);
    _allocations jsonb:='[]'; _owner record; _metadata jsonb;
    _refinancing jsonb:='{}'; _ref_left jsonb; _ref_take jsonb;
BEGIN
    SET search_path TO budgeting;
    IF current_setting('budgeting.crypto_source_event_id',true) IS DISTINCT FROM _sid::text THEN
        RAISE EXCEPTION 'Funding changes require source journal';
    END IF;
    SELECT owner_type,owner_user_id,owner_family_id INTO _owner FROM bank_accounts
        WHERE id=(SELECT anchor_account_id FROM crypto_source_events WHERE id=_sid);
    -- Consume exactly the same proportion as the monetary WAC ledger.
    FOR _e IN SELECT e.* FROM portfolio_events e JOIN crypto_source_event_links l
        ON l.ledger_table='portfolio_events' AND l.ledger_id=e.id
        WHERE l.source_event_id=_sid AND l.command_index=_idx
        AND e.event_type IN ('transfer_out','swap_out','fee','partial_close','close') ORDER BY e.id
    LOOP
        _old:=_before->'positions'->(_e.position_id::text);
        _map:=COALESCE(_old->'units','{}');
        IF _map='{}' THEN CONTINUE; END IF;
        _q:=(_old->>'quantity')::numeric;
        IF _q<=0 OR _e.quantity>_q THEN RAISE EXCEPTION 'Invalid funding withdrawal'; END IF;
        _moved:=budgeting.calc__crypto_funding_units('{}',_map,_e.quantity/_q);
        UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
            budgeting.calc__crypto_funding_units(COALESCE(metadata->'funding_units','{}'),_moved,-1)) WHERE id=_e.position_id;
        _out:=jsonb_set(_out,ARRAY[_e.position_id::text],_moved);
        UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('funding_units_moved',_moved) WHERE id=_e.id;
        IF _kind IN ('position_income','protocol_yield','fee','expense','bank_withdraw','bank_sell','sell_fiat') THEN
            UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('funding_units',_moved) WHERE id=_e.id;
        END IF;
    END LOOP;
    IF _kind IN ('swap','staking_convert','transfer') THEN
        _map:=COALESCE(_out->(_p->>'position_id'),'{}');
        FOR _e IN SELECT e.* FROM portfolio_events e JOIN crypto_source_event_links l
            ON l.ledger_table='portfolio_events' AND l.ledger_id=e.id
            WHERE l.source_event_id=_sid AND l.command_index=_idx
            AND e.event_type IN ('open','top_up','transfer_in','swap_in') LOOP
            UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
                budgeting.calc__crypto_funding_units(metadata->'funding_units',_map)) WHERE id=_e.position_id;
        END LOOP;
    ELSIF _kind='borrow' THEN
        _loan:=_p->>'position_id';
        SELECT metadata INTO _metadata FROM crypto_protocol_positions WHERE id=_loan::bigint;
        _pid:=(_metadata->>'borrowed_position_id')::bigint;
        _map:=jsonb_build_object(_loan,(_p->>'debt_qty')::numeric);
        UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
            budgeting.calc__crypto_funding_units(metadata->'funding_units',_map)) WHERE id=_pid;
        UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object('funding_policy','components') WHERE id=_loan::bigint;
    ELSIF _kind='create_protocol' THEN
        UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
            'funding_units0',COALESCE(_out->(_p->>'source_position_id'),'{}'),
            'funding_units1',COALESCE(_out->(_p->>'secondary_source_position_id'),'{}'))
            WHERE id=(_result->>'id')::bigint;
    ELSIF _kind='top_up_protocol' THEN
        UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
            'funding_units0',budgeting.calc__crypto_funding_units(metadata->'funding_units0',COALESCE(_out->(_p->>'source_position_id'),'{}')),
            'funding_units1',budgeting.calc__crypto_funding_units(metadata->'funding_units1',COALESCE(_out->(_p->>'secondary_source_position_id'),'{}')))
            WHERE id=(_p->>'position_id')::bigint;
    ELSIF _kind IN ('close_protocol','partial_close_protocol') THEN
        _old:=_before->'protocols'->(_p->>'position_id');
        _a0:=COALESCE(_old->'metadata'->'funding_units0','{}');
        _b0:=COALESCE(_old->'metadata'->'funding_units1','{}');
        _a:=_a0; _b:=_b0;
        IF _a<>'{}' OR _b<>'{}' THEN
            IF _kind='close_protocol' AND _old->>'position_type'='liquidity_pool' THEN
                IF _p->>'allocation_policy' IS DISTINCT FROM 'net_composition' THEN RAISE EXCEPTION 'Funding LP requires net composition'; END IF;
                _pa:=(_old->>'quantity')::numeric; _pb:=(_old->'metadata'->>'token1_quantity')::numeric;
                _ra:=(_p->>'return_quantity')::numeric; _rb:=(_p->>'secondary_return_quantity')::numeric;
                IF _ra<_pa THEN
                    _a:=budgeting.calc__crypto_funding_units('{}',_a0,_ra/_pa);
                    _b:=budgeting.calc__crypto_funding_units(_b0,budgeting.calc__crypto_funding_units(_a0,_a,-1));
                ELSIF _rb<_pb THEN
                    _b:=budgeting.calc__crypto_funding_units('{}',_b0,_rb/_pb);
                    _a:=budgeting.calc__crypto_funding_units(_a0,budgeting.calc__crypto_funding_units(_b0,_b,-1));
                END IF;
            ELSIF _kind='partial_close_protocol' THEN
                IF _old->>'position_type'='liquidity_pool' THEN
                    IF COALESCE((_p->>'principal_qty')::numeric,0)>0 OR COALESCE((_p->>'secondary_principal_qty')::numeric,0)>0 THEN
                        RAISE EXCEPTION 'Partial funded LP exit is not implemented';
                    END IF;
                    _a:='{}'; _b:='{}';
                END IF;
                _a:=budgeting.calc__crypto_funding_units('{}',_a0,COALESCE((_p->>'principal_qty')::numeric,0)/NULLIF((_old->>'quantity')::numeric,0));
            END IF;
            FOR _e IN SELECT e.* FROM portfolio_events e JOIN crypto_source_event_links l
                ON l.ledger_table='portfolio_events' AND l.ledger_id=e.id
                WHERE l.source_event_id=_sid AND l.command_index=_idx
                AND e.event_type IN ('open','top_up','transfer_in') LOOP
                _map:=CASE WHEN _e.metadata->>'token_role'='token_b' THEN _b ELSE _a END;
                UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
                    budgeting.calc__crypto_funding_units(metadata->'funding_units',_map)) WHERE id=_e.position_id;
            END LOOP;
        END IF;
        UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
            'funding_units0',CASE WHEN _kind='close_protocol' THEN '{}'::jsonb ELSE budgeting.calc__crypto_funding_units(_a0,_a,-1) END,
            'funding_units1',CASE WHEN _kind='close_protocol' THEN '{}'::jsonb ELSE budgeting.calc__crypto_funding_units(_b0,_b,-1) END) WHERE id=(_p->>'position_id')::bigint;
    ELSIF _kind='fee_refund' THEN
        SELECT e.* INTO _e FROM portfolio_events e JOIN crypto_source_event_links l
            ON l.ledger_table='portfolio_events' AND l.ledger_id=e.id
            WHERE l.source_event_id=_sid AND l.command_index=_idx AND e.metadata->>'source_kind'='fee_refund';
        _q:=(_e.metadata->>'fee_pool_quantity_before')::numeric;
        _map:='{}';
        FOR _h IN SELECT e.id,e.metadata FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
            WHERE p.investment_account_id=(_p->>'investment_account_id')::bigint
            AND p.metadata->>'crypto_asset_id'=_p->>'crypto_asset_id' AND e.event_type='fee'
            AND COALESCE(e.metadata->'funding_units','{}')<>'{}' LOOP
            _moved:=budgeting.calc__crypto_funding_units('{}',_h.metadata->'funding_units',(_p->>'quantity')::numeric/_q);
            _map:=budgeting.calc__crypto_funding_units(_map,_moved);
            UPDATE portfolio_events SET metadata=jsonb_set(metadata,'{funding_units}',
                budgeting.calc__crypto_funding_units(metadata->'funding_units',_moved,-1)) WHERE id=_h.id;
        END LOOP;
        UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
            budgeting.calc__crypto_funding_units(metadata->'funding_units',_map)) WHERE id=_e.position_id;
    ELSIF _kind IN ('repay','liquidate') THEN
        _loan:=_p->>'position_id';
        IF _kind='repay' THEN
        _body:=(_p->>'repay_qty')::numeric-COALESCE((_p->>'interest_qty')::numeric,0);
        SELECT e.* INTO _e FROM portfolio_events e JOIN crypto_source_event_links l
            ON l.ledger_table='portfolio_events' AND l.ledger_id=e.id
            WHERE l.source_event_id=_sid AND l.command_index=_idx AND e.metadata->>'target_kind'='lending_repay';
        _expense_id:=_e.id;
        UPDATE crypto_liability_events SET realized_in_base=0
            WHERE portfolio_event_id=_expense_id;
        _cash:=(_e.metadata->>'consumed_cost_basis')::numeric;
        IF _cash IS NULL THEN RAISE EXCEPTION 'Cannot settle unknown repayment cost'; END IF;
        _interest:=_cash-round(_cash*_body/(_p->>'repay_qty')::numeric,2);
        _cash:=_cash-_interest;
        _map:=COALESCE(_out->(_p->>'source_position_id'),'{}');
        -- New-loan units used for principal replace old-loan units at their
        -- current holders. The interest share remains an expense holder.
        _refinancing:=budgeting.calc__crypto_funding_units('{}',_map-_loan,
            _body/(_p->>'repay_qty')::numeric);
        _self:=round(COALESCE((_map->>_loan)::numeric,0)*_body/(_p->>'repay_qty')::numeric,18);
        IF _self>_body THEN RAISE EXCEPTION 'Return contains more same-loan units than principal repaid'; END IF;
        ELSE
            _old:=_before->'protocols'->COALESCE(_p->>'collateral_position_id',_loan);
            _body:=(_p->>'debt_qty')::numeric-COALESCE((_p->>'interest_qty')::numeric,0);
            _cash:=(_result->>'collateral_cost_consumed_in_base')::numeric;
            IF _cash IS NULL THEN RAISE EXCEPTION 'Cannot settle unknown liquidation cost'; END IF;
            _pa:=((_p->>'collateral_qty')::numeric-COALESCE((_p->>'collateral_fee_qty')::numeric,0))/(_p->>'collateral_qty')::numeric;
            _pb:=_body/(_p->>'debt_qty')::numeric;
            _interest:=_cash-round(_cash*_pa*_pb,2);
            _cash:=_cash-_interest;
            _map:=budgeting.calc__crypto_funding_units('{}',_old->'metadata'->'funding_units0',
                (_p->>'collateral_qty')::numeric/(_old->>'quantity')::numeric);
            -- Collateral can carry financing from another loan. Its principal
            -- share replaces the settled loan's units at their current holders;
            -- the interest/penalty share stays with the liquidation expense.
            _refinancing:=budgeting.calc__crypto_funding_units('{}',_map-_loan,
                _pa*_pb);
            _self:=round(COALESCE((_map->>_loan)::numeric,0)*_pa*_pb,18);
            IF _self>_body THEN RAISE EXCEPTION 'Liquidated self-financing exceeds principal settled'; END IF;
            UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
                'funding_units0',budgeting.calc__crypto_funding_units(metadata->'funding_units0',_map,-1),
                'cost_basis_carried',cost_basis_in_base) WHERE id=COALESCE(_p->>'collateral_position_id',_loan)::bigint;
            SELECT id INTO _pid FROM portfolio_positions WHERE investment_account_id=(_old->>'investment_account_id')::bigint
                AND metadata->>'crypto_asset_id'=_old->>'crypto_asset_id' ORDER BY (status='open') DESC,id DESC LIMIT 1;
            IF _pid IS NULL THEN RAISE EXCEPTION 'Liquidation collateral source position is missing'; END IF;
            -- Zero quantity: collateral was removed by the protocol function. This
            -- expense holder carries only financing/interest/penalty, never wallet coins.
            INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,comment,metadata,created_by_user_id)
            VALUES(_pid,'transfer_out',_day,0,'Проценты и издержки ликвидации',jsonb_build_object(
                'consumed_cost_basis',0,'source_kind','liquidation_funding_settlement',
                'protocol_position_id',_loan,'liability_event_id',_result->'liability_event_id'),_uid)
                RETURNING id INTO _expense_id;
            UPDATE crypto_liability_events SET realized_in_base=0,
                metadata=metadata||jsonb_build_object('funding_policy','components',
                    'funding_principal_cost',_cash,'funding_expense_cost',_interest)
                WHERE id=(_result->>'liability_event_id')::bigint;
        END IF;
        _settle:=_body-_self;
        -- The interest-paid fraction is an expense holder, not self-cancelled principal.
        _map:=budgeting.calc__crypto_funding_units(
            budgeting.calc__crypto_funding_units(_map,jsonb_build_object(_loan,_self),-1),
            _refinancing,-1);
        UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('funding_units',_map,
            'funding_interest_cost',_interest,'funding_principal_cost',_cash,
            'funding_self_cancelled',_self,'funding_refinanced_units',_refinancing,
            'funding_policy','components','realized_in_base',0)
            WHERE id=_expense_id;
        SELECT sum(u) INTO _total FROM (
            SELECT COALESCE((metadata->'funding_units'->>_loan)::numeric,0) u FROM portfolio_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT COALESCE((metadata->'funding_units0'->>_loan)::numeric,0)+COALESCE((metadata->'funding_units1'->>_loan)::numeric,0) FROM crypto_protocol_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT COALESCE((e.metadata->'funding_units'->>_loan)::numeric,0) FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
                WHERE p.owner_type=_owner.owner_type AND p.owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND p.owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
        ) t;
        IF _settle>COALESCE(_total,0) OR (_settle=0 AND (_cash<>0 OR _refinancing<>'{}'::jsonb)) THEN RAISE EXCEPTION 'Funding settlement mismatch'; END IF;
        _left_units:=_settle; _left_cash:=_cash; _ref_left:=_refinancing;
        FOR _h IN SELECT * FROM (
            SELECT 'position' kind,id,'funding_units' field,(metadata->'funding_units'->>_loan)::numeric units FROM portfolio_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT 'protocol',id,'funding_units0',(metadata->'funding_units0'->>_loan)::numeric FROM crypto_protocol_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT 'protocol',id,'funding_units1',(metadata->'funding_units1'->>_loan)::numeric FROM crypto_protocol_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT 'expense',e.id,'funding_units',(e.metadata->'funding_units'->>_loan)::numeric FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
                WHERE p.owner_type=_owner.owner_type AND p.owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND p.owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
        ) holders WHERE units>0 ORDER BY kind,id,field LOOP
            _take:=CASE WHEN _h.units=_total THEN _left_units ELSE round(_left_units*_h.units/_total,18) END;
            _cost:=CASE WHEN _h.units=_total THEN _left_cash ELSE round(_left_cash*_h.units/_total,2) END;
            _ref_take:=CASE WHEN _h.units=_total THEN _ref_left
                ELSE budgeting.calc__crypto_funding_units('{}',_ref_left,_h.units/_total) END;
            _units_after:=_h.units-_take;
            _map:=jsonb_build_object(_loan,_take);
            IF _h.kind='position' THEN
                UPDATE portfolio_positions SET metadata=jsonb_set(metadata,ARRAY[_h.field],budgeting.calc__crypto_funding_units(budgeting.calc__crypto_funding_units(metadata->_h.field,_map,-1),_ref_take)) WHERE id=_h.id;
                IF _cost>0 THEN
                    INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,comment,metadata,created_by_user_id)
                    VALUES(_h.id,'top_up',_day,0,'Уточнение затрат при погашении займа',jsonb_build_object(
                        'entry_value_in_base',_cost,'basis_quality','estimated','source_kind','funding_settlement','loan_position_id',_loan,'settled_units',_take),_uid);
                END IF;
            ELSIF _h.kind='protocol' THEN
                UPDATE crypto_protocol_positions SET cost_basis_in_base=cost_basis_in_base+_cost,
                    metadata=jsonb_set(metadata,ARRAY[_h.field],budgeting.calc__crypto_funding_units(budgeting.calc__crypto_funding_units(metadata->_h.field,_map,-1),_ref_take))
                    || jsonb_build_object(CASE WHEN _h.field='funding_units0' THEN 'cost_basis_carried' ELSE 'token1_cost_basis_carried' END,
                        COALESCE((metadata->>CASE WHEN _h.field='funding_units0' THEN 'cost_basis_carried' ELSE 'token1_cost_basis_carried' END)::numeric,0)+_cost,
                        'basis_quality','estimated',CASE WHEN _h.field='funding_units0' THEN 'token0_basis_quality' ELSE 'token1_basis_quality' END,'estimated') WHERE id=_h.id;
            ELSE
                SELECT metadata INTO _metadata FROM portfolio_events WHERE id=_h.id;
                IF _cost>0 AND _metadata->>'funding_bank_withdrawal'='true' THEN
                    RAISE EXCEPTION 'Bank withdrawal financing dust acquired monetary cost; rebuild required';
                END IF;
                IF _metadata->>'funding_bank_withdrawal'='true' AND EXISTS(
                    SELECT 1 FROM jsonb_each_text(_ref_take) u WHERE abs(u.value::numeric)>0.000000000001) THEN
                    RAISE EXCEPTION 'Bank withdrawal cannot receive refinanced debt';
                END IF;
                IF _cost>0 AND _metadata->>'funding_bank_sale'='true' THEN
                    _base:=budgeting.get__owner_base_currency(_owner.owner_type,_owner.owner_user_id,_owner.owner_family_id);
                    _fx:=budgeting.get__owner_system_category_id(_owner.owner_type,_owner.owner_user_id,_owner.owner_family_id,'FX Result');
                    _unallocated:=budgeting.get__owner_system_category_id(_owner.owner_type,_owner.owner_user_id,_owner.owner_family_id,'Unallocated');
                    INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
                    VALUES(_uid,_owner.owner_type,_owner.owner_user_id,_owner.owner_family_id,'investment_trade',
                        'Уточнение себестоимости проданной криптовалюты при погашении займа',_day) RETURNING id INTO _operation;
                    INSERT INTO budget_entries(operation_id,category_id,currency_code,amount)
                    VALUES(_operation,_fx,_base,-_cost),(_operation,_unallocated,_base,_cost);
                    PERFORM budgeting.put__apply_current_budget_delta(_fx,_base,-_cost);
                    PERFORM budgeting.put__apply_current_budget_delta(_unallocated,_base,_cost);
                END IF;
                IF _metadata->>'action'='fiat_sell' THEN
                    -- Proceeds and the fiat lot are fixed; repayment only refines disposal cost.
                    UPDATE portfolio_events SET metadata=metadata||jsonb_build_object(
                        'realized_in_base',COALESCE((metadata->>'realized_in_base')::numeric,0)-_cost)
                    WHERE id=_h.id;
                END IF;
                UPDATE portfolio_events SET metadata=jsonb_set(metadata,ARRAY[_h.field],budgeting.calc__crypto_funding_units(budgeting.calc__crypto_funding_units(metadata->_h.field,_map,-1),_ref_take))
                    ||jsonb_build_object('funding_confirmed_cost',COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)+_cost) WHERE id=_h.id;
            END IF;
            _allocations:=_allocations||jsonb_build_array(jsonb_build_object('holder_kind',_h.kind,'holder_id',_h.id,'field',_h.field,'units',_take,'cost',_cost,'replacement_units',_ref_take));
            _ref_left:=budgeting.calc__crypto_funding_units(_ref_left,_ref_take,-1);
            _left_units:=_left_units-_take; _left_cash:=_left_cash-_cost; _total:=_total-_h.units;
        END LOOP;
        IF _left_units<>0 OR _left_cash<>0 OR _ref_left<>'{}'::jsonb THEN RAISE EXCEPTION 'Funding settlement remainder'; END IF;
    ELSIF _kind='sell_fiat' THEN
        IF _out<>'{}'::jsonb AND NOT COALESCE((_p->>'defer_manual_expense')::boolean,false) THEN
            RAISE EXCEPTION 'Funded fiat sale requires pending manual settlement tracking';
        END IF;
    ELSIF _kind NOT IN ('position_income','protocol_yield','fee','expense','bank_withdraw','bank_sell','accrue','accrue_interest','bank_buy','bank_to_portfolio','reward','receive_unknown','quantity_correction','lp_custody','fee_refund','observation','tag_lending_account','group_lending') THEN
        RAISE EXCEPTION 'Command not supported by funding component accounting: %',_kind;
    END IF;
    -- Assert conservation after every command, not merely at the final snapshot.
    FOR _h IN SELECT id,metadata FROM crypto_protocol_positions
        WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id
        AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id AND metadata->>'funding_policy'='components'
    LOOP
        _loan:=_h.id::text;
        SELECT COALESCE(sum(u),0) INTO _total FROM (
            SELECT (metadata->'funding_units'->>_loan)::numeric u FROM portfolio_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT COALESCE((metadata->'funding_units0'->>_loan)::numeric,0)+COALESCE((metadata->'funding_units1'->>_loan)::numeric,0) FROM crypto_protocol_positions
                WHERE owner_type=_owner.owner_type AND owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
            UNION ALL SELECT (e.metadata->'funding_units'->>_loan)::numeric FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
                WHERE p.owner_type=_owner.owner_type AND p.owner_user_id IS NOT DISTINCT FROM _owner.owner_user_id AND p.owner_family_id IS NOT DISTINCT FROM _owner.owner_family_id
        ) t;
        _body:=COALESCE((_h.metadata->>'borrowed_quantity')::numeric,0)-COALESCE((_h.metadata->>'debt_interest_quantity')::numeric,0);
        IF _total<>_body THEN RAISE EXCEPTION 'Financing units % differ from principal % for loan %',_total,_body,_loan; END IF;
    END LOOP;
    RETURN jsonb_build_object('policy','components','withdrawals',_out,'settlements',_allocations);
END
$f$;
