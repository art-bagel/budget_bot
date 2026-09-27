-- All economic LP actions use the owner-locked, replayable source journal.
CREATE OR REPLACE FUNCTION budgeting.put__crypto_lp_action(
    _uid bigint, _kind text, _args jsonb, _day date
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
    p record; a record; pid bigint; eid bigint; i integer; aq numeric; bq numeric;
    share numeric; fulla numeric; fullb numeric; ca numeric; cb numeric; takea numeric; takeb numeric;
    ua jsonb; ub jsonb; moved_a jsonb; moved_b jsonb; old_units jsonb;
    asset_id bigint; qty numeric; cost numeric; units jsonb; quality text; base char(3);
BEGIN
    SET search_path TO budgeting;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
        RAISE EXCEPTION 'LP actions require the source journal';
    END IF;
    IF _kind NOT IN ('lp_snapshot','lp_withdraw','lp_reward') OR _kind IS NULL
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(_args) k WHERE k NOT IN
            ('position_id','quantity','secondary_quantity','share_percent','crypto_asset_id','secondary_crypto_asset_id','comment')) THEN
        RAISE EXCEPTION 'Unsupported LP action';
    END IF;
    SELECT * INTO p FROM crypto_protocol_positions WHERE id=(_args->>'position_id')::bigint FOR UPDATE;
    IF p.id IS NULL OR NOT budgeting.has__owner_access(_uid,p.owner_type,p.owner_user_id,p.owner_family_id) THEN
        RAISE EXCEPTION 'Unknown or inaccessible LP';
    END IF;
    IF p.status<>'open' OR p.position_type<>'liquidity_pool' THEN RAISE EXCEPTION 'Open liquidity position required'; END IF;
    aq:=(_args->>'quantity')::numeric;
    bq:=(_args->>'secondary_quantity')::numeric;
    IF aq IS NULL OR aq<0 OR aq::text IN ('NaN','Infinity','-Infinity') OR aq<>round(aq,18)
        OR (_kind<>'lp_reward' AND (bq IS NULL OR bq<0 OR bq::text IN ('NaN','Infinity','-Infinity') OR bq<>round(bq,18))) THEN
        RAISE EXCEPTION 'Укажите точные неотрицательные количества монет';
    END IF;
    IF _kind='lp_snapshot' THEN
        IF _args ?| ARRAY['share_percent','crypto_asset_id'] THEN RAISE EXCEPTION 'Unexpected snapshot fields'; END IF;
        IF _args ? 'secondary_crypto_asset_id' THEN
            SELECT * INTO a FROM crypto_assets WHERE id=(_args->>'secondary_crypto_asset_id')::bigint;
            IF a.id IS NULL OR a.id=p.crypto_asset_id OR p.crypto_asset_id IS NULL
                OR (p.metadata->>'token1_crypto_asset_id' IS NOT NULL AND (p.metadata->>'token1_crypto_asset_id')::bigint<>a.id) THEN
                RAISE EXCEPTION 'Нельзя заменить монету уже определённой пары';
            END IF;
            IF p.metadata->>'token1_crypto_asset_id' IS NULL THEN
                IF COALESCE((p.metadata->>'token1_quantity')::numeric,0)<>0
                    OR COALESCE((p.metadata->>'token1_cost_basis_carried')::numeric,0)<>0 THEN
                    RAISE EXCEPTION 'Необходимо уточнить исходное внесение второй монеты';
                END IF;
                UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
                    'token1_crypto_asset_id',a.id,'token1_symbol',a.symbol,'token1_quantity',0,
                    'token1_cost_basis_carried',0,'token1_basis_quality','confirmed_zero') WHERE id=p.id;
            END IF;
        ELSIF p.metadata->>'token1_crypto_asset_id' IS NULL THEN
            RAISE EXCEPTION 'Укажите вторую монету пула';
        END IF;
        -- Observation is separate from cost-allocation anchors. Looking at the pool
        -- more often must not change the eventual withdrawal cost.
        UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object('lp_composition',
            jsonb_build_object('quantity0',aq::text,'quantity1',bq::text,'observed_at',_day)),
            updated_at=current_timestamp WHERE id=p.id;
    ELSE
        IF _args ? 'secondary_crypto_asset_id' THEN RAISE EXCEPTION 'Вторая монета задаётся через состав пула'; END IF;
        base:=budgeting.get__owner_base_currency(p.owner_type,p.owner_user_id,p.owner_family_id);
        IF _kind='lp_reward' THEN
            IF aq<=0 OR _args->>'crypto_asset_id' IS NULL OR _args ?| ARRAY['share_percent','secondary_quantity'] THEN
                RAISE EXCEPTION 'Укажите монету и количество полученной награды';
            END IF;
        ELSE
            IF _args ? 'crypto_asset_id' THEN RAISE EXCEPTION 'Unexpected withdrawal asset'; END IF;
            share:=(_args->>'share_percent')::numeric/100;
            IF share IS NULL OR share<=0 OR share>1 OR share::text IN ('NaN','Infinity','-Infinity')
                OR share<>round(share,18) OR aq+bq<=0 THEN RAISE EXCEPTION 'Доля вывода должна быть больше 0 и не больше 100%%'; END IF;
            IF p.crypto_asset_id IS NULL OR p.metadata->>'token1_crypto_asset_id' IS NULL THEN
                RAISE EXCEPTION 'Не определены обе монеты позиции';
            END IF;
            fulla:=aq/share; fullb:=bq/share;
            IF (fulla<p.quantity AND fullb<=COALESCE((p.metadata->>'token1_quantity')::numeric,0))
                OR (fullb<COALESCE((p.metadata->>'token1_quantity')::numeric,0) AND fulla<=p.quantity) THEN
                RAISE EXCEPTION 'Уменьшение состава не объясняется обменом. Сначала уточните потери или долю вывода';
            END IF;
            IF p.metadata->>'basis_quality'='invalid' THEN RAISE EXCEPTION 'Invalid LP cost'; END IF;
            cb:=(p.metadata->>'token1_cost_basis_carried')::numeric; ca:=p.cost_basis_in_base-cb;
            IF p.metadata->>'basis_quality'='unknown' OR p.metadata->>'token0_basis_quality'='unknown'
                OR p.metadata->>'token1_basis_quality'='unknown' OR ca IS NULL OR cb IS NULL THEN ca:=NULL; cb:=NULL;
            ELSIF ca<0 OR cb<0 THEN RAISE EXCEPTION 'Invalid LP component costs'; END IF;
            ua:=COALESCE(p.metadata->'funding_units0','{}'); ub:=COALESCE(p.metadata->'funding_units1','{}');
            IF fulla<p.quantity THEN
                ca:=round(ca*fulla/p.quantity,2); cb:=p.cost_basis_in_base-ca;
                old_units:=ua; ua:=budgeting.calc__crypto_funding_units('{}',ua,fulla/p.quantity);
                ub:=budgeting.calc__crypto_funding_units(ub,budgeting.calc__crypto_funding_units(old_units,ua,-1));
            ELSIF fullb<(p.metadata->>'token1_quantity')::numeric THEN
                cb:=round(cb*fullb/(p.metadata->>'token1_quantity')::numeric,2); ca:=p.cost_basis_in_base-cb;
                old_units:=ub; ub:=budgeting.calc__crypto_funding_units('{}',ub,fullb/(p.metadata->>'token1_quantity')::numeric);
                ua:=budgeting.calc__crypto_funding_units(ua,budgeting.calc__crypto_funding_units(old_units,ub,-1));
            END IF;
            -- Round total once, then allocate the second leg as its complement.
            takea:=round(ca*share,2); takeb:=round((ca+cb)*share,2)-takea;
            moved_a:=budgeting.calc__crypto_funding_units('{}',ua,share);
            moved_b:=budgeting.calc__crypto_funding_units('{}',ub,share);
            UPDATE crypto_protocol_positions SET quantity=round(fulla-aq,18),current_quantity=round(fulla-aq,18),
                cost_basis_in_base=ca+cb-takea-takeb,
                current_value_in_base=round(COALESCE(p.current_value_in_base,0)*(1-share),2),
                status=CASE WHEN share=1 THEN 'closed' ELSE 'open' END,
                withdrawn_at=CASE WHEN share=1 THEN _day ELSE NULL END,
                metadata=(metadata-'lp_composition')||jsonb_build_object(
                    'token1_quantity',round(fullb-bq,18),'token1_cost_basis_carried',cb-takeb,
                    'lp_basis_policy','net_composition',
                    'basis_quality',CASE WHEN ca IS NULL THEN 'unknown' ELSE 'estimated' END,
                    'token0_basis_quality',CASE WHEN ca IS NULL THEN 'unknown' ELSE 'estimated' END,
                    'token1_basis_quality',CASE WHEN cb IS NULL THEN 'unknown' ELSE 'estimated' END,
                    'funding_units0',budgeting.calc__crypto_funding_units(ua,moved_a,-1),
                    'funding_units1',budgeting.calc__crypto_funding_units(ub,moved_b,-1),
                    'lp_composition',jsonb_build_object('quantity0',round(fulla-aq,18)::text,'quantity1',round(fullb-bq,18)::text,'observed_at',_day)),
                updated_at=current_timestamp WHERE id=p.id;
        END IF;
        FOR i IN 0..CASE WHEN _kind='lp_reward' THEN 0 ELSE 1 END LOOP
            asset_id:=CASE WHEN _kind='lp_reward' THEN (_args->>'crypto_asset_id')::bigint
                WHEN i=0 THEN p.crypto_asset_id ELSE (p.metadata->>'token1_crypto_asset_id')::bigint END;
            qty:=CASE WHEN i=0 THEN aq ELSE bq END;
            IF qty=0 THEN CONTINUE; END IF;
            cost:=CASE WHEN _kind='lp_reward' THEN 0 WHEN i=0 THEN takea ELSE takeb END;
            units:=CASE WHEN _kind='lp_reward' THEN '{}'::jsonb WHEN i=0 THEN moved_a ELSE moved_b END;
            quality:=CASE WHEN cost IS NULL THEN 'unknown' WHEN cost=0 THEN 'confirmed_zero' ELSE 'estimated' END;
            SELECT * INTO a FROM crypto_assets WHERE id=asset_id;
            IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown reward asset'; END IF;
            SELECT id INTO pid FROM portfolio_positions WHERE investment_account_id=p.investment_account_id
                AND status='open' AND asset_type_code='crypto' AND metadata->>'crypto_asset_id'=asset_id::text FOR UPDATE;
            IF pid IS NULL THEN
                INSERT INTO portfolio_positions(owner_type,owner_user_id,owner_family_id,investment_account_id,
                    asset_type_code,title,quantity,amount_in_currency,currency_code,opened_at,metadata,created_by_user_id)
                VALUES(p.owner_type,p.owner_user_id,p.owner_family_id,p.investment_account_id,'crypto',a.symbol,0,0,base,_day,
                    jsonb_build_object('crypto_asset_id',a.id,'asset_symbol',a.symbol,'asset_name',a.name,
                        'network_code',a.network_code,'contract_address',a.contract_address),_uid) RETURNING id INTO pid;
            END IF;
            UPDATE portfolio_positions SET quantity=quantity+qty,metadata=metadata||jsonb_build_object('funding_units',
                budgeting.calc__crypto_funding_units(COALESCE(metadata->'funding_units','{}'),units)) WHERE id=pid;
            INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,metadata,comment,created_by_user_id)
            VALUES(pid,CASE WHEN _kind='lp_reward' THEN 'income' ELSE 'top_up' END,_day,qty,
                jsonb_build_object('action',CASE WHEN _kind='lp_reward' THEN 'rewards_from_protocol' ELSE 'partial_return_from_protocol' END,
                    'protocol_position_id',p.id,'source_protocol_position_id',p.id,'protocol_name',p.protocol_name,
                    'source_kind',CASE WHEN _kind='lp_reward' THEN 'income' ELSE 'defi_return' END,
                    'income_kind',CASE WHEN _kind='lp_reward' THEN 'reward' ELSE NULL END,
                    'entry_value_in_base',cost,'basis_quality',quality,'funding_units_moved',units,
                    'share_percent',_args->'share_percent','token_role',CASE WHEN i=1 THEN 'token_b' ELSE 'token_a' END),
                _args->>'comment',_uid) RETURNING id INTO eid;
        END LOOP;
        IF _kind='lp_reward' THEN UPDATE crypto_protocol_positions SET updated_at=current_timestamp WHERE id=p.id; END IF;
    END IF;
    RETURN (SELECT item FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_uid,p.investment_account_id,NULL)) item
        WHERE (item->>'id')::bigint=p.id);
END
$f$;
