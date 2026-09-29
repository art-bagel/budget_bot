DROP FUNCTION IF EXISTS budgeting.put__crypto_source_event;
CREATE FUNCTION budgeting.put__crypto_source_event(
    _user_id bigint, _anchor_account_id bigint, _source_namespace text, _source_id text,
    _occurred_at timestamptz, _order_in_timestamp bigint, _accounting_date date,
    _commands jsonb, _evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _account record;
    _owner_key text;
    _prior record;
    _id bigint;
    _command jsonb;
    _kind text;
    _payload jsonb;
    _index integer := 0;
    _result jsonb;
    _results jsonb := '[]'::jsonb;
    _links jsonb;
    _key text;
    _resource_account bigint;
    _resource record;
    _numeric numeric;
    _summary jsonb;
    _refund_basis numeric;
    _refund_unknown boolean;
    _refund_estimated boolean;
    _funding_mode boolean;
    _funding_before jsonb;
    _funding_audit jsonb;
    _conversion_source record;
    _conversion_target record;
    _group_peer record;
    _group_key text;
    _old_source text := current_setting('budgeting.crypto_source_event_id',true);
    _old_index text := current_setting('budgeting.crypto_source_command_index',true);
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO _account FROM bank_accounts WHERE id=_anchor_account_id;
    IF _account.id IS NULL OR NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source journal account';
    END IF;
    IF NOT ((_account.account_kind='investment' AND _account.investment_asset_type='crypto')
        OR (_account.account_kind='cash' AND jsonb_typeof(_commands)='array'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(_commands) c WHERE c->>'kind' NOT IN ('bank_buy','bank_cash_sell','bank_asset_merge','bank_swap','bank_expense','bank_crypto_expense','bank_purchase','budget_allocate')))) THEN
        RAISE EXCEPTION 'Source journal requires a crypto investment account';
    END IF;
    _owner_key := _account.owner_type || ':' || CASE WHEN _account.owner_type='user' THEN _account.owner_user_id ELSE _account.owner_family_id END;
    IF NULLIF(btrim(_source_namespace),'') IS NULL OR NULLIF(btrim(_source_id),'') IS NULL
        OR _occurred_at IS NULL OR NOT isfinite(_occurred_at)
        OR _order_in_timestamp IS NULL OR _order_in_timestamp<0
        OR _accounting_date IS NULL OR NOT isfinite(_accounting_date)
        OR abs(_accounting_date-(_occurred_at AT TIME ZONE 'UTC')::date)>1
        OR _commands IS NULL OR jsonb_typeof(_commands)<>'array'
        OR jsonb_array_length(_commands) NOT BETWEEN 1 AND 100
        OR _evidence IS NULL OR jsonb_typeof(_evidence)<>'object' THEN
        RAISE EXCEPTION 'Invalid source envelope, order, commands or date';
    END IF;
    -- All journal callers for one owner serialize, including calls from different family members.
    PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||_owner_key,0));
    SELECT * INTO _prior FROM crypto_source_events
        WHERE owner_key=_owner_key AND source_namespace=_source_namespace AND source_id=_source_id;
    IF FOUND AND current_setting('budgeting.crypto_replay_source',true) IS DISTINCT FROM _prior.id::text THEN
        IF _prior.anchor_account_id IS DISTINCT FROM _anchor_account_id
            OR _prior.occurred_at IS DISTINCT FROM _occurred_at
            OR _prior.order_in_timestamp IS DISTINCT FROM _order_in_timestamp
            OR _prior.accounting_date IS DISTINCT FROM _accounting_date
            OR _prior.commands IS DISTINCT FROM _commands OR _prior.evidence IS DISTINCT FROM _evidence THEN
            RAISE EXCEPTION 'Source event already posted with different input; rebuild dependent history';
        END IF;
        RETURN _prior.result;
    END IF;
    IF current_setting('budgeting.crypto_replay_source',true) IS DISTINCT FROM COALESCE(_prior.id::text,'missing') AND EXISTS(SELECT 1 FROM crypto_source_events WHERE owner_key=_owner_key
        AND (occurred_at,order_in_timestamp)>=(_occurred_at,_order_in_timestamp)) THEN
        RAISE EXCEPTION 'Source event is out of order; rebuild dependent history';
    END IF;
    IF _prior.id IS NOT NULL AND current_setting('budgeting.crypto_replay_source',true)=_prior.id::text THEN
        _id:=_prior.id;
    ELSE
    INSERT INTO crypto_source_events(owner_key,anchor_account_id,source_namespace,source_id,
        occurred_at,order_in_timestamp,accounting_date,commands,evidence,created_by_user_id)
    VALUES(_owner_key,_anchor_account_id,_source_namespace,_source_id,_occurred_at,
        _order_in_timestamp,_accounting_date,_commands,_evidence,_user_id) RETURNING id INTO _id;
    END IF;
    UPDATE crypto_source_events SET reversible=true WHERE id=_id;
    PERFORM set_config('budgeting.crypto_source_event_id',_id::text,true);
    FOR _command IN SELECT value FROM jsonb_array_elements(_commands) LOOP
        IF jsonb_typeof(_command)<>'object' OR NOT (_command ?& ARRAY['kind','payload'])
            OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('kind','payload'))
            OR jsonb_typeof(_command->'payload')<>'object' THEN
            RAISE EXCEPTION 'Each command requires only kind and payload';
        END IF;
        _kind := _command->>'kind';
        _payload := _command->'payload';
        -- A create + initial borrowing is one atomic, replayable source.
        IF _payload ? 'position_id_from_command' THEN
            IF _kind<>'borrow' OR _payload ? 'position_id'
                OR (_payload->>'position_id_from_command')::integer<0
                OR (_payload->>'position_id_from_command')::integer>=_index
                OR _commands->((_payload->>'position_id_from_command')::integer)->>'kind'<>'create_protocol' THEN
                RAISE EXCEPTION 'Invalid created protocol reference';
            END IF;
            _payload:=(_payload-'position_id_from_command')||jsonb_build_object('position_id',
                _results->((_payload->>'position_id_from_command')::integer)->'id');
        END IF;
        IF _payload ? 'link_protocol_position_id_from_command' THEN
            IF _kind<>'fee' OR _payload ? 'link_protocol_position_id'
                OR (_payload->>'link_protocol_position_id_from_command')::integer<0
                OR (_payload->>'link_protocol_position_id_from_command')::integer>=_index
                OR _commands->((_payload->>'link_protocol_position_id_from_command')::integer)->>'kind'<>'create_protocol' THEN
                RAISE EXCEPTION 'Invalid protocol fee reference';
            END IF;
            _payload:=(_payload-'link_protocol_position_id_from_command')||jsonb_build_object('link_protocol_position_id',
                _results->((_payload->>'link_protocol_position_id_from_command')::integer)->'id');
        END IF;
        PERFORM set_config('budgeting.crypto_source_command_index',_index::text,true);
        -- Every referenced account/position must be in the journal owner scope.
        FOREACH _key IN ARRAY ARRAY['position_id','source_position_id','secondary_source_position_id',
            'link_protocol_position_id','collateral_position_id','other_position_id','investment_account_id','target_investment_account_id'] LOOP
            IF _payload->>_key IS NULL THEN CONTINUE; END IF;
            IF _key IN ('investment_account_id','target_investment_account_id') THEN
                _resource_account := (_payload->>_key)::bigint;
            ELSIF _key IN ('link_protocol_position_id','collateral_position_id','other_position_id') OR (_key='position_id' AND _kind NOT IN ('swap','transfer','staking_convert','bank_sell','bank_withdraw','bank_to_portfolio','position_income')) THEN
                SELECT investment_account_id INTO _resource_account FROM crypto_protocol_positions WHERE id=(_payload->>_key)::bigint;
            ELSE
                SELECT investment_account_id INTO _resource_account FROM portfolio_positions WHERE id=(_payload->>_key)::bigint;
            END IF;
            SELECT * INTO _resource FROM bank_accounts WHERE id=_resource_account;
            IF _resource.id IS NULL OR _resource.owner_type IS DISTINCT FROM _account.owner_type
                OR _resource.owner_user_id IS DISTINCT FROM _account.owner_user_id
                OR _resource.owner_family_id IS DISTINCT FROM _account.owner_family_id
                OR _resource.account_kind<>'investment' OR _resource.investment_asset_type<>'crypto' THEN
                RAISE EXCEPTION 'Command resource is outside source journal owner scope';
            END IF;
        END LOOP;
        -- JSON quantities are passed as decimal strings, never rounded through float.
        FOR _key IN SELECT jsonb_object_keys(_payload) LOOP
            IF _payload->>_key IS NULL THEN CONTINUE; END IF;
            IF _key IN ('quantity','amount','from_amount','to_amount','collateral_before','debt_before')
                OR _key LIKE '%\_quantity' OR _key LIKE '%\_qty' THEN
                _numeric := (_payload->>_key)::numeric;
                IF _numeric<0 OR _numeric::text IN ('NaN','Infinity','-Infinity') OR _numeric<>round(_numeric,18) THEN
                    RAISE EXCEPTION 'Source quantities must be finite, nonnegative and exact to 18 decimals';
                END IF;
            END IF;
        END LOOP;
        IF _kind='create_protocol' THEN
            IF _payload->>'source_position_id' IS NULL AND NOT (
                _payload->>'position_type'='lending'
                AND COALESCE((_payload->>'quantity')::numeric,0)=0
                AND COALESCE((_payload->>'cost_basis_in_base')::numeric,0)=0
                AND COALESCE((_payload->>'current_value_in_base')::numeric,0)=0
                AND COALESCE((_payload->>'borrowed_quantity')::numeric,0)=0
            ) THEN
                RAISE EXCEPTION 'Historical protocol deposit requires a source position';
            END IF;
            IF (_payload->>'current_quantity' IS NOT NULL AND
                (_payload->>'current_quantity')::numeric IS DISTINCT FROM (_payload->>'quantity')::numeric)
                OR COALESCE((_payload->>'rewards_claimed_in_base')::numeric,0)<>0
                OR COALESCE((_payload->>'rewards_unclaimed_in_base')::numeric,0)<>0 THEN
                RAISE EXCEPTION 'Post protocol accruals separately; do not import final balances';
            END IF;
        END IF;
        IF _payload ? 'funding_policy' AND (_kind<>'borrow' OR _payload->>'funding_policy' IS DISTINCT FROM 'components') THEN
            RAISE EXCEPTION 'Unsupported funding policy';
        END IF;
        _funding_mode:=COALESCE(_payload->>'funding_policy'='components',false) OR EXISTS(
            SELECT 1 FROM crypto_protocol_positions WHERE owner_type=_account.owner_type
            AND owner_user_id IS NOT DISTINCT FROM _account.owner_user_id
            AND owner_family_id IS NOT DISTINCT FROM _account.owner_family_id AND metadata->>'funding_policy'='components');
        IF _funding_mode THEN
            SELECT jsonb_build_object('positions',COALESCE((SELECT jsonb_object_agg(id::text,
                jsonb_build_object('quantity',quantity,'units',COALESCE(metadata->'funding_units','{}')))
                FROM portfolio_positions WHERE owner_type=_account.owner_type AND owner_user_id IS NOT DISTINCT FROM _account.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _account.owner_family_id),'{}'::jsonb),
                'protocols',COALESCE((SELECT jsonb_object_agg(id::text,to_jsonb(p)) FROM crypto_protocol_positions p
                WHERE owner_type=_account.owner_type AND owner_user_id IS NOT DISTINCT FROM _account.owner_user_id AND owner_family_id IS NOT DISTINCT FROM _account.owner_family_id),'{}'::jsonb)) INTO _funding_before;
            _payload:=_payload-'funding_policy';
            IF _kind IN ('borrow','repay','accrue') THEN
                _payload:=_payload-'valuation_quality'-'valuation_source';
                IF _kind='borrow' THEN _payload:=_payload||jsonb_build_object('value_in_base',0);
                ELSIF _kind='repay' THEN _payload:=_payload||jsonb_build_object('value_in_base',NULL);
                ELSE _payload:=_payload||jsonb_build_object('interest_value_in_base',0); END IF;
            END IF;
            IF _kind='swap' AND _payload->>'basis_policy' IS DISTINCT FROM 'carry' THEN
                RAISE EXCEPTION 'Funded history requires carry swaps';
            END IF;
        END IF;
        CASE _kind
        WHEN 'lp_snapshot','lp_withdraw','lp_reward' THEN
            _result:=budgeting.put__crypto_lp_action(_user_id,_kind,_payload,_accounting_date);
        WHEN 'bank_asset_merge','bank_swap','bank_expense','bank_crypto_expense','bank_purchase','bank_settle_sale','budget_allocate' THEN
            _result:=budgeting.put__execute_bank_journal_command(_user_id,_anchor_account_id,_kind,_payload);
        WHEN 'group_lending' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN ('position_id','other_position_id'))
                OR _payload->>'position_id' IS NULL OR _payload->>'other_position_id' IS NULL
                OR _payload->>'position_id'=_payload->>'other_position_id' THEN
                RAISE EXCEPTION 'Выберите две разные позиции одного lending-счёта';
            END IF;
            SELECT * INTO _resource FROM crypto_protocol_positions WHERE id=(_payload->>'position_id')::bigint FOR UPDATE;
            SELECT * INTO _group_peer FROM crypto_protocol_positions WHERE id=(_payload->>'other_position_id')::bigint FOR UPDATE;
            IF _resource.position_type<>'lending' OR _group_peer.position_type<>'lending'
                OR _resource.status<>'open' OR _group_peer.status<>'open'
                OR _resource.investment_account_id<>_group_peer.investment_account_id
                OR _resource.network_code IS DISTINCT FROM _group_peer.network_code THEN
                RAISE EXCEPTION 'Нужны открытые залоги одной сети на одном инвестиционном счёте';
            END IF;
            IF NULLIF(_resource.metadata->>'lending_account_key','') IS NOT NULL
                AND NULLIF(_group_peer.metadata->>'lending_account_key','') IS NOT NULL
                AND _resource.metadata->>'lending_account_key' IS DISTINCT FROM _group_peer.metadata->>'lending_account_key' THEN
                RAISE EXCEPTION 'Позиции уже принадлежат разным счетам протокола. Объединение запрещено';
            END IF;
            _group_key:=COALESCE(NULLIF(_resource.metadata->>'lending_account_key',''),
                NULLIF(_group_peer.metadata->>'lending_account_key',''),'manual:'||LEAST(_resource.id,_group_peer.id));
            IF EXISTS(SELECT 1 FROM crypto_protocol_positions p WHERE p.investment_account_id=_resource.investment_account_id
                AND p.status='open' AND p.position_type='lending'
                AND (p.id IN (_resource.id,_group_peer.id) OR p.metadata->>'lending_account_key'=_group_key)
                AND COALESCE((p.metadata->>'borrowed_quantity')::numeric,0)>0
                GROUP BY p.metadata->>'borrowed_crypto_asset_id' HAVING count(*)>1) THEN
                RAISE EXCEPTION 'В выбранных позициях уже два долга одной монеты. Сначала требуется сверка истории';
            END IF;
            UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
                'lending_account_key',_group_key,'lending_group_confirmed_by',_user_id),updated_at=current_timestamp
                WHERE id IN (_resource.id,_group_peer.id);
            _result:=jsonb_build_object('position_id',_resource.id,'other_position_id',_group_peer.id,
                'lending_account_key',_group_key,'economic_change',false);
        WHEN 'tag_lending_account' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN ('position_id','master_contract','user_contract'))
                OR COALESCE(_payload->>'master_contract','') !~ '^0:[0-9a-f]{64}$'
                OR COALESCE(_payload->>'user_contract','') !~ '^0:[0-9a-f]{64}$' THEN
                RAISE EXCEPTION 'Lending identity requires canonical master and user contracts';
            END IF;
            SELECT * INTO _resource FROM crypto_protocol_positions WHERE id=(_payload->>'position_id')::bigint FOR UPDATE;
            IF _resource.id IS NULL OR _resource.position_type<>'lending'
                OR _resource.owner_type IS DISTINCT FROM _account.owner_type
                OR _resource.owner_user_id IS DISTINCT FROM _account.owner_user_id
                OR _resource.owner_family_id IS DISTINCT FROM _account.owner_family_id THEN
                RAISE EXCEPTION 'Lending position belongs to another owner or is unavailable';
            END IF;
            IF _resource.metadata ? 'lending_account_key' AND _resource.metadata->>'lending_account_key'
                IS DISTINCT FROM (_payload->>'master_contract')||'/'||(_payload->>'user_contract') THEN
                RAISE EXCEPTION 'Cannot change an established lending account identity';
            END IF;
            IF COALESCE((_resource.metadata->>'borrowed_quantity')::numeric,0)>0 AND EXISTS (
                SELECT 1 FROM crypto_protocol_positions p
                WHERE p.id<>_resource.id AND p.status='open' AND p.position_type='lending'
                  AND p.investment_account_id=_resource.investment_account_id
                  AND p.network_code IS NOT DISTINCT FROM _resource.network_code
                  AND p.metadata->>'lending_account_key'=(_payload->>'master_contract')||'/'||(_payload->>'user_contract')
                  AND p.metadata->>'borrowed_crypto_asset_id'=_resource.metadata->>'borrowed_crypto_asset_id'
                  AND COALESCE((p.metadata->>'borrowed_quantity')::numeric,0)>0
            ) THEN
                RAISE EXCEPTION 'Cannot group duplicate active debts of the same currency';
            END IF;
            UPDATE crypto_protocol_positions SET metadata=metadata||jsonb_build_object(
                'lending_master_contract',_payload->>'master_contract',
                'lending_user_contract',_payload->>'user_contract',
                'lending_account_key',(_payload->>'master_contract')||'/'||(_payload->>'user_contract'))
                WHERE id=_resource.id;
            _result:=jsonb_build_object('position_id',_resource.id,'economic_change',false);
        WHEN 'observation' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k<>'comment')
                OR NULLIF(btrim(_payload->>'comment'),'') IS NULL
                OR (_evidence->'zero_movement' IS DISTINCT FROM 'true'::jsonb
                    AND NOT COALESCE(CASE WHEN jsonb_typeof(_evidence->'excluded_token_movements')='array'
                        THEN jsonb_array_length(_evidence->'excluded_token_movements')>0 ELSE false END,false)) THEN
                RAISE EXCEPTION 'Observation requires zero movement evidence and a comment';
            END IF;
            _result:=jsonb_build_object('observed',true,'economic_change',false);
        WHEN 'lp_custody' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(
                ARRAY['position_id','receipt_master','quantity','from_custody','to_custody']))) THEN
                RAISE EXCEPTION 'Unsupported LP custody argument';
            END IF;
            FOREACH _key IN ARRAY ARRAY['position_id','receipt_master','quantity','from_custody','to_custody'] LOOP
                IF NULLIF(btrim(_payload->>_key),'') IS NULL THEN RAISE EXCEPTION 'Missing LP custody argument %',_key; END IF;
            END LOOP;
            SELECT * INTO _resource FROM crypto_protocol_positions
            WHERE id=(_payload->>'position_id')::bigint FOR UPDATE;
            IF _resource.status IS DISTINCT FROM 'open' OR _resource.position_type IS DISTINCT FROM 'liquidity_pool'
                OR _resource.metadata->'lp_receipt'->>'master' IS DISTINCT FROM _payload->>'receipt_master'
                OR _resource.metadata->'lp_receipt'->>'custody' IS DISTINCT FROM _payload->>'from_custody'
                OR (_resource.metadata->'lp_receipt'->>'quantity')::numeric IS DISTINCT FROM (_payload->>'quantity')::numeric
                OR (_payload->>'quantity')::numeric<=0 THEN
                RAISE EXCEPTION 'LP receipt does not match current custody';
            END IF;
            IF _payload->>'to_custody' = _payload->>'from_custody'
                OR NOT (_payload->>'to_custody'='main' OR _payload->>'to_custody' ~ '^0:[0-9a-f]{64}$') THEN
                RAISE EXCEPTION 'Invalid LP custody destination';
            END IF;
            -- Receipt ownership and principal remain unchanged. The immutable
            -- source envelope records the transition; no new capital or income.
            UPDATE crypto_protocol_positions SET metadata=jsonb_set(metadata,'{lp_receipt,custody}',_payload->'to_custody'),
                updated_at=current_timestamp WHERE id=_resource.id;
            _result:=jsonb_build_object('position_id',_resource.id,'receipt_master',_payload->>'receipt_master',
                'quantity',_payload->>'quantity','from_custody',_payload->>'from_custody','to_custody',_payload->>'to_custody',
                'cost_basis_in_base',_resource.cost_basis_in_base);
        WHEN 'bank_withdraw' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(
                ARRAY['position_id','bank_account_id','quantity','comment','defer_manual_expense'])))
                OR NOT (_payload ?& ARRAY['position_id','bank_account_id','quantity']) THEN
                RAISE EXCEPTION 'Bank withdrawal requires position, bank and quantity';
            END IF;
            SELECT * INTO _resource FROM bank_accounts WHERE id=(_payload->>'bank_account_id')::bigint;
            IF _resource.owner_type IS DISTINCT FROM _account.owner_type
                OR _resource.owner_user_id IS DISTINCT FROM _account.owner_user_id
                OR _resource.owner_family_id IS DISTINCT FROM _account.owner_family_id THEN
                RAISE EXCEPTION 'Bank withdrawal must stay within source journal owner';
            END IF;
            -- Bank lots do not yet support unsettled loan financing. Allow only
            -- less than one atomic unit of the borrowed asset, retaining it in
            -- the journal's financing holder and conservation check. A universal
            -- 1e-12 threshold incorrectly blocks fractional USDC dust.
            IF EXISTS(SELECT 1 FROM portfolio_positions p
                CROSS JOIN LATERAL jsonb_each_text(COALESCE(p.metadata->'funding_units','{}')) u
                LEFT JOIN crypto_protocol_positions loan ON loan.id=u.key::bigint
                LEFT JOIN crypto_assets borrowed ON borrowed.id=(loan.metadata->>'borrowed_crypto_asset_id')::bigint
                WHERE p.id=(_payload->>'position_id')::bigint
                AND (borrowed.id IS NULL OR abs(u.value::numeric * (_payload->>'quantity')::numeric / p.quantity)
                    >= power(10::numeric,-borrowed.decimals))) THEN
                RAISE EXCEPTION 'Settle financing before withdrawing crypto to bank';
            END IF;
            _result:=budgeting.put__transfer_crypto_from_investment(_user_id,
                (_payload->>'position_id')::bigint,(_payload->>'bank_account_id')::bigint,
                (_payload->>'quantity')::numeric,NULL,_payload->>'comment',_accounting_date);
            IF _payload ? 'defer_manual_expense' AND jsonb_typeof(_payload->'defer_manual_expense')<>'boolean' THEN
                RAISE EXCEPTION 'Deferred bank expense flag must be boolean';
            END IF;
            IF COALESCE((_payload->>'defer_manual_expense')::boolean,false) THEN
                UPDATE crypto_lots SET metadata=metadata||jsonb_build_object('reserved_for_manual_expense',true)
                WHERE opened_by_operation_id=(_result->>'operation_id')::bigint;
            END IF;
            UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('funding_bank_withdrawal',true)
            WHERE linked_operation_id=(_result->>'operation_id')::bigint;
        WHEN 'bank_sell' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(
                ARRAY['position_id','bank_account_id','quantity','fiat_amount','comment'])))
                OR NOT (_payload ?& ARRAY['position_id','bank_account_id','quantity','fiat_amount']) THEN
                RAISE EXCEPTION 'Bank sale requires position, bank, quantity and proceeds';
            END IF;
            _numeric:=(_payload->>'fiat_amount')::numeric;
            IF _numeric<=0 OR _numeric::text IN ('NaN','Infinity','-Infinity') OR _numeric<>round(_numeric,2) THEN
                RAISE EXCEPTION 'Bank sale proceeds must be positive exact money';
            END IF;
            SELECT * INTO _resource FROM portfolio_positions WHERE id=(_payload->>'position_id')::bigint;
            -- One atomic transfer and immediate base-currency sale. Existing bank
            -- holdings would mix FIFO lots with this funding holder, so reject them.
            IF EXISTS(SELECT 1 FROM crypto_lots WHERE bank_account_id=(_payload->>'bank_account_id')::bigint
                AND crypto_asset_id=(_resource.metadata->>'crypto_asset_id')::bigint AND amount_remaining>0) THEN
                RAISE EXCEPTION 'Immediate bank sale requires no prior lots of this coin';
            END IF;
            _result:=budgeting.put__transfer_crypto_from_investment(_user_id,
                (_payload->>'position_id')::bigint,(_payload->>'bank_account_id')::bigint,
                (_payload->>'quantity')::numeric,NULL,_payload->>'comment',_accounting_date);
            _result:=jsonb_build_object('transfer',_result,'sale',budgeting.put__sell_crypto_asset(_user_id,
                (_payload->>'bank_account_id')::bigint,(_resource.metadata->>'crypto_asset_id')::bigint,
                (_payload->>'quantity')::numeric,
                budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id),
                _numeric,_payload->>'comment',_accounting_date));
            IF EXISTS(SELECT 1 FROM crypto_lot_consumptions c JOIN crypto_lots l ON l.id=c.lot_id
                WHERE c.operation_id=(_result->'sale'->>'operation_id')::bigint
                AND l.opened_by_operation_id<>(_result->'transfer'->>'operation_id')::bigint) THEN
                RAISE EXCEPTION 'Concurrent bank lots changed; retry the atomic sale';
            END IF;
            UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('funding_bank_sale',true,
                'bank_sale_operation_id',_result->'sale'->'operation_id','bank_sale_proceeds',_numeric)
            WHERE linked_operation_id=(_result->'transfer'->>'operation_id')::bigint;
        WHEN 'bank_cash_sell' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN
              ('bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount','comment')) THEN
                RAISE EXCEPTION 'Unsupported cash sale argument';
            END IF;
            SELECT * INTO _resource FROM bank_accounts WHERE id=(_payload->>'bank_account_id')::bigint;
            IF _resource.id IS NULL OR _resource.account_kind<>'cash'
                OR _resource.owner_type IS DISTINCT FROM _account.owner_type
                OR _resource.owner_user_id IS DISTINCT FROM _account.owner_user_id
                OR _resource.owner_family_id IS DISTINCT FROM _account.owner_family_id THEN
                RAISE EXCEPTION 'Bank sale is outside journal owner';
            END IF;
            _result:=budgeting.put__sell_crypto_asset(_user_id,(_payload->>'bank_account_id')::bigint,
                (_payload->>'crypto_asset_id')::bigint,(_payload->>'quantity')::numeric,
                (_payload->>'fiat_currency_code')::char(3),(_payload->>'fiat_amount')::numeric,
                _payload->>'comment',_accounting_date);
        WHEN 'bank_buy', 'bank_to_portfolio' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(
                CASE WHEN _kind='bank_buy' THEN ARRAY['bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount','comment']
                ELSE ARRAY['bank_account_id','investment_account_id','crypto_asset_id','quantity','comment','purchase_quality','purchase_source','position_id','title'] END))) THEN
                RAISE EXCEPTION 'Unsupported argument for bank crypto command';
            END IF;
            FOREACH _key IN ARRAY CASE WHEN _kind='bank_buy'
                THEN ARRAY['bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount']
                ELSE ARRAY['bank_account_id','investment_account_id','crypto_asset_id','quantity'] END LOOP
                IF _payload->>_key IS NULL THEN RAISE EXCEPTION 'Missing bank crypto argument %',_key; END IF;
            END LOOP;
            SELECT * INTO _resource FROM bank_accounts WHERE id=(_payload->>'bank_account_id')::bigint;
            IF _resource.id IS NULL OR NOT _resource.is_active OR _resource.account_kind<>'cash'
                OR _resource.owner_type IS DISTINCT FROM _account.owner_type
                OR _resource.owner_user_id IS DISTINCT FROM _account.owner_user_id
                OR _resource.owner_family_id IS DISTINCT FROM _account.owner_family_id THEN
                RAISE EXCEPTION 'Bank account is outside source journal owner scope';
            END IF;
            IF _kind='bank_buy' THEN
                IF _source_namespace<>'manual-portfolio-v1' AND _payload->>'fiat_currency_code' IS DISTINCT FROM
                    budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id)::text THEN
                    RAISE EXCEPTION 'Historical bank buy currently requires base currency';
                END IF;
                _numeric:=(_payload->>'fiat_amount')::numeric;
                IF _numeric<=0 OR _numeric::text IN ('NaN','Infinity','-Infinity') OR _numeric<>round(_numeric,CASE WHEN _payload->>'fiat_currency_code'=budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id)::text THEN 2 ELSE 8 END) THEN
                    RAISE EXCEPTION 'Historical bank purchase amount must be positive exact money';
                END IF;
                _result:=budgeting.put__buy_crypto_asset(_user_id,(_payload->>'bank_account_id')::bigint,
                    (_payload->>'fiat_currency_code')::char(3),_numeric,(_payload->>'crypto_asset_id')::bigint,
                    (_payload->>'quantity')::numeric,_payload->>'comment',_accounting_date);
            ELSE
                IF _payload ? 'purchase_quality' AND
                    (_payload->>'purchase_quality' IS DISTINCT FROM 'estimated' OR NULLIF(btrim(_payload->>'purchase_source'),'') IS NULL) THEN
                    RAISE EXCEPTION 'Estimated bank purchase requires its source';
                END IF;
                IF _payload ? 'purchase_source' AND NOT (_payload ? 'purchase_quality') THEN
                    RAISE EXCEPTION 'Purchase source requires explicit quality';
                END IF;
                _result:=budgeting.put__transfer_crypto_to_investment(_user_id,(_payload->>'bank_account_id')::bigint,
                    (_payload->>'investment_account_id')::bigint,(_payload->>'crypto_asset_id')::bigint,
                    (_payload->>'quantity')::numeric,(_payload->>'position_id')::bigint,_payload->>'title',_payload->>'comment',_accounting_date);
                IF _payload->>'purchase_quality'='estimated' THEN
                    UPDATE portfolio_events e SET metadata=e.metadata || jsonb_build_object(
                        'basis_quality','estimated','purchase_source',_payload->>'purchase_source')
                    FROM crypto_source_event_links l WHERE l.source_event_id=_id AND l.command_index=_index
                        AND l.ledger_table='portfolio_events' AND l.ledger_id=e.id;
                    _result:=_result || jsonb_build_object('basis_quality','estimated','purchase_source',_payload->>'purchase_source');
                END IF;
            END IF;
        WHEN 'buy_fiat', 'sell_fiat' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY[
                'investment_account_id','bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount','comment','historical_value_in_base','valuation_source','defer_manual_expense','purchase_quality','purchase_source']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for fiat trade';
            END IF;
            FOREACH _key IN ARRAY ARRAY['investment_account_id','bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount'] LOOP
                IF _payload->>_key IS NULL THEN RAISE EXCEPTION 'Missing required fiat trade argument %',_key; END IF;
            END LOOP;
            _result:=budgeting.put__crypto_fiat_trade(_user_id,
                CASE WHEN _kind='buy_fiat' THEN 'buy' ELSE 'sell' END,
                (_payload->>'investment_account_id')::bigint,(_payload->>'bank_account_id')::bigint,
                (_payload->>'crypto_asset_id')::bigint,(_payload->>'quantity')::numeric,
                _payload->>'fiat_currency_code',(_payload->>'fiat_amount')::numeric,
                _payload->>'comment',_accounting_date,(_payload->>'historical_value_in_base')::numeric,
                _payload->>'valuation_source',COALESCE((_payload->>'defer_manual_expense')::boolean,false),
                _payload->>'purchase_quality',_payload->>'purchase_source');
        WHEN 'settle_fiat_sale' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY[
                'sale_event_id','category_id','comment']::text[])))
                OR _payload->>'sale_event_id' IS NULL OR _payload->>'category_id' IS NULL THEN
                RAISE EXCEPTION 'Invalid manual settlement arguments';
            END IF;
            _result:=budgeting.put__settle_crypto_fiat_sale(_user_id,_anchor_account_id,
                (_payload->>'sale_event_id')::bigint,(_payload->>'category_id')::bigint,
                _payload->>'comment',_accounting_date);
        WHEN 'staking_convert' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY[
                'position_id','from_amount','to_crypto_asset_id','to_amount','comment','target_investment_account_id']::text[])))
                OR NOT(_payload ?& ARRAY['position_id','from_amount','to_crypto_asset_id','to_amount']) THEN
                RAISE EXCEPTION 'Invalid staking conversion arguments';
            END IF;
            SELECT p.*,a.network_code AS source_network,a.contract_address AS source_contract
                INTO _conversion_source FROM portfolio_positions p
                JOIN crypto_assets a ON a.id=(p.metadata->>'crypto_asset_id')::bigint
                WHERE p.id=(_payload->>'position_id')::bigint FOR UPDATE OF p;
            SELECT * INTO _conversion_target FROM crypto_assets WHERE id=(_payload->>'to_crypto_asset_id')::bigint;
            IF _conversion_source.source_network IS DISTINCT FROM 'ton' OR _conversion_target.network_code IS DISTINCT FROM 'ton'
                OR NOT((COALESCE(_conversion_source.source_contract,'')='' AND _conversion_target.contract_address='0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892')
                    OR (_conversion_source.source_contract='0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892' AND COALESCE(_conversion_target.contract_address,'')='')) THEN
                RAISE EXCEPTION 'Only the identified TON/bemo receipt conversion is supported';
            END IF;
            _summary:=budgeting.get__crypto_position_movable_entry_summary(_conversion_source.id);
            _numeric:=round((_summary->>'remaining_cost_basis')::numeric * (_payload->>'from_amount')::numeric / NULLIF(_conversion_source.quantity,0),2);
            _result:=budgeting.put__swap_crypto_investment_asset(_user_id,_conversion_source.id,
                (_payload->>'from_amount')::numeric,_conversion_target.id,(_payload->>'to_amount')::numeric,
                (_payload->>'target_investment_account_id')::bigint,_payload->>'comment',_accounting_date,_numeric,'staking carried basis, not market valuation');
            UPDATE portfolio_events SET metadata=(metadata-'valuation_source'-'valuation_date'-'value_at_swap_in_base') ||
                jsonb_build_object('source_kind','staking_conversion','target_kind','staking_conversion',
                    'basis_quality',_summary->>'basis_quality','realized_in_base',0,'economic_kind','staking_conversion')
                WHERE linked_operation_id=(_result->>'operation_id')::bigint;
            _result:=_result || jsonb_build_object('economic_kind','staking_conversion','carried_cost_basis',_numeric,'basis_quality',_summary->>'basis_quality');
        WHEN 'quantity_correction' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY[
                'investment_account_id','crypto_asset_id','quantity','comment']::text[])))
                OR _payload->>'investment_account_id' IS NULL OR _payload->>'crypto_asset_id' IS NULL
                OR (_payload->>'quantity')::numeric IS NULL OR (_payload->>'quantity')::numeric<=0
                OR NULLIF(btrim(_payload->>'comment'),'') IS NULL
                OR NOT(_evidence ? 'quantity_correction') THEN
                RAISE EXCEPTION 'Quantity correction requires positive quantity, explanation and source evidence';
            END IF;
            -- This is an explicitly evidenced rounding adjustment, not income.
            -- The existing monetary basis stays intact; only its denominator changes.
            _result:=budgeting.put__crypto_receive_reward(_user_id,
                (_payload->>'investment_account_id')::bigint,(_payload->>'crypto_asset_id')::bigint,
                (_payload->>'quantity')::numeric,_payload->>'comment',_accounting_date);
            UPDATE portfolio_events SET event_type='top_up',metadata=(metadata-'income_kind') ||
                jsonb_build_object('entry_value_in_base',0,'basis_quality','estimated',
                    'source_kind','quantity_correction','correction_evidence',_evidence->'quantity_correction')
                WHERE id=(_result->>'event_id')::bigint;
            _result:=_result || jsonb_build_object('source_kind','quantity_correction','basis_quality','estimated');
        WHEN 'protocol_yield' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN ('position_id','quantity'))
                OR COALESCE((_payload->>'quantity')::numeric,0)<=0 THEN
                RAISE EXCEPTION 'Укажите положительное начисление монет';
            END IF;
            SELECT * INTO _resource FROM crypto_protocol_positions WHERE id=(_payload->>'position_id')::bigint FOR UPDATE;
            IF _resource.status<>'open' OR _resource.position_type NOT IN ('staking','lending','vault','other') THEN
                RAISE EXCEPTION 'Начисление доступно для открытого стейкинга или залога';
            END IF;
            _numeric:=(_payload->>'quantity')::numeric;
            UPDATE crypto_protocol_positions SET current_quantity=current_quantity+_numeric,
                quantity=quantity+CASE WHEN position_type='lending' THEN _numeric ELSE 0 END,
                updated_at=current_timestamp WHERE id=_resource.id;
            SELECT item INTO _result FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(
                _user_id,_resource.investment_account_id,NULL)) item WHERE (item->>'id')::bigint=_resource.id;
            INSERT INTO crypto_protocol_accrual_events(protocol_position_id,external_id,event_at,
                collateral_quantity,interest_quantity,request,result,created_by_user_id)
            VALUES(_resource.id,_source_namespace||':'||_source_id||':'||_index,_accounting_date,
                _numeric,0,_payload,_result,_user_id);
        WHEN 'position_income' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE k NOT IN
                ('position_id','amount','currency_code','amount_in_base','quantity','income_kind','destination','comment')) THEN
                RAISE EXCEPTION 'Unsupported reward argument';
            END IF;
            IF NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE id=(_payload->>'position_id')::bigint AND asset_type_code='crypto') THEN
                RAISE EXCEPTION 'Ручной криптожурнал поддерживает только криптоактивы';
            END IF;
            _result:=budgeting.put__record_portfolio_income(_user_id,(_payload->>'position_id')::bigint,
                COALESCE((_payload->>'amount')::numeric,0),(_payload->>'currency_code')::char(3),
                (_payload->>'amount_in_base')::numeric,_payload->>'income_kind',_accounting_date,_payload->>'comment',
                _occurred_at,COALESCE(_payload->>'destination','position'),(_payload->>'quantity')::numeric);
        WHEN 'linked_fee_refund' THEN
            _result:=budgeting.put__linked_fee_refund(_user_id,_payload,_accounting_date);
        WHEN 'reward', 'receive_unknown', 'fee_refund' THEN
            IF _payload ? 'basis_assumption' AND (_kind<>'receive_unknown' OR (_payload->>'basis_assumption') IS DISTINCT FROM 'owner_zero' OR NULLIF(btrim(_payload->>'comment'),'') IS NULL) THEN
                RAISE EXCEPTION 'Zero-basis assumption requires an unclassified receipt and explanation';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['investment_account_id','crypto_asset_id','quantity','comment','basis_assumption']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for reward';
            END IF;
            IF _payload->>'investment_account_id' IS NULL OR _payload->>'crypto_asset_id' IS NULL OR _payload->>'quantity' IS NULL THEN
                RAISE EXCEPTION 'Missing required argument for reward';
            END IF;
            IF _kind='fee_refund' THEN
                PERFORM 1 FROM bank_accounts WHERE id=(_payload->>'investment_account_id')::bigint FOR UPDATE;
                SELECT COALESCE(sum(CASE WHEN e.event_type='fee' THEN e.quantity ELSE -e.quantity END),0),
                    COALESCE(sum(CASE WHEN e.event_type='fee' THEN (e.metadata->>'consumed_cost_basis')::numeric
                        ELSE -(e.metadata->>'entry_value_in_base')::numeric END),0),
                    COALESCE(bool_or(CASE WHEN e.event_type='fee' THEN e.metadata->>'consumed_cost_basis' IS NULL
                        ELSE e.metadata->>'entry_value_in_base' IS NULL END),false),
                    COALESCE(bool_or(e.metadata->>'basis_quality'='estimated'),false)
                    INTO _numeric,_refund_basis,_refund_unknown,_refund_estimated
                    FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
                    WHERE p.investment_account_id=(_payload->>'investment_account_id')::bigint
                        AND p.metadata->>'crypto_asset_id'=_payload->>'crypto_asset_id'
                        AND (e.event_type='fee' OR e.metadata->>'source_kind'='fee_refund');
                IF (_payload->>'quantity')::numeric<=0 OR (_payload->>'quantity')::numeric>_numeric THEN
                    RAISE EXCEPTION 'Technical refund exceeds the prior unrecovered fee pool';
                END IF;
                _refund_basis:=CASE WHEN _refund_unknown THEN NULL
                    ELSE round(_refund_basis*(_payload->>'quantity')::numeric/_numeric,2) END;
            END IF;
            _result := budgeting.put__crypto_receive_reward(_user_id,
                (_payload->>'investment_account_id')::bigint,
                (_payload->>'crypto_asset_id')::bigint,
                (_payload->>'quantity')::numeric, _payload->>'comment', _accounting_date);
            IF _kind='fee_refund' THEN
                UPDATE portfolio_events SET event_type='top_up',metadata=(metadata-'income_kind') ||
                    jsonb_build_object('entry_value_in_base',_refund_basis,
                        'basis_quality',CASE WHEN _refund_basis IS NULL THEN 'unknown' WHEN _refund_estimated THEN 'estimated' WHEN _refund_basis=0 THEN 'confirmed_zero' ELSE 'known' END,
                        'source_kind','fee_refund','fee_pool_quantity_before',_numeric,'allocation_policy','pooled_historical_fee_cost')
                    WHERE id=(_result->>'event_id')::bigint;
                _result:=_result || jsonb_build_object('entry_value_in_base',_refund_basis,
                    'basis_quality',CASE WHEN _refund_basis IS NULL THEN 'unknown' WHEN _refund_estimated THEN 'estimated' WHEN _refund_basis=0 THEN 'confirmed_zero' ELSE 'known' END);
            END IF;
            IF _kind='receive_unknown' THEN
                UPDATE portfolio_events SET event_type='top_up',metadata=(metadata-'income_kind') ||
                    jsonb_build_object('entry_value_in_base',CASE WHEN _payload->>'basis_assumption'='owner_zero' THEN 0 ELSE NULL END,
                        'basis_quality',CASE WHEN _payload->>'basis_assumption'='owner_zero' THEN 'estimated' ELSE 'unknown' END,
                        'basis_assumption',_payload->>'basis_assumption','source_kind','unclassified_receipt')
                    WHERE id=(_result->>'event_id')::bigint;
                _result:=_result || jsonb_build_object('entry_value_in_base',CASE WHEN _payload->>'basis_assumption'='owner_zero' THEN 0 ELSE NULL END,
                    'basis_quality',CASE WHEN _payload->>'basis_assumption'='owner_zero' THEN 'estimated' ELSE 'unknown' END);
            END IF;
        WHEN 'expense' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['source_position_id','quantity','comment']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for expense';
            END IF;
            IF _payload->>'source_position_id' IS NULL OR _payload->>'quantity' IS NULL THEN
                RAISE EXCEPTION 'Missing required argument for expense';
            END IF;
            _result := budgeting.put__crypto_consume(_user_id,
                (_payload->>'source_position_id')::bigint,
                (_payload->>'quantity')::numeric, 'expense', _payload->>'comment', _accounting_date);
        WHEN 'swap' THEN
            IF _payload ? 'basis_policy' AND (_payload->>'basis_policy') IS DISTINCT FROM 'carry' THEN
                RAISE EXCEPTION 'Unsupported swap basis policy';
            END IF;
            IF _payload->>'basis_policy'='carry' THEN
                IF _payload ?| ARRAY['value_in_base','valuation_source','valuation_quality'] THEN
                    RAISE EXCEPTION 'Carried swap must not supply a market valuation';
                END IF;
                SELECT * INTO _conversion_source FROM portfolio_positions
                    WHERE id=(_payload->>'position_id')::bigint FOR UPDATE;
                IF _conversion_source.id IS NULL OR NOT budgeting.has__owner_access(
                    _user_id,_conversion_source.owner_type,_conversion_source.owner_user_id,_conversion_source.owner_family_id) THEN
                    RAISE EXCEPTION 'Unknown or inaccessible carry source';
                END IF;
                _summary:=budgeting.get__crypto_position_movable_entry_summary(_conversion_source.id);
                _numeric:=round((_summary->>'remaining_cost_basis')::numeric
                    * (_payload->>'from_amount')::numeric / NULLIF(_conversion_source.quantity,0),2);
            END IF;
            IF _payload ? 'valuation_quality' AND ((_payload->>'valuation_quality') IS DISTINCT FROM 'estimated'
                OR _payload->>'value_in_base' IS NULL OR NULLIF(btrim(_payload->>'valuation_source'),'') IS NULL) THEN
                RAISE EXCEPTION 'Estimated swap valuation requires amount and source';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','from_amount','to_crypto_asset_id','to_amount','target_investment_account_id','comment','value_in_base','valuation_source','valuation_quality','basis_policy']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for swap';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'from_amount') OR _payload->'from_amount'='null'::jsonb OR NOT (_payload ? 'to_crypto_asset_id') OR _payload->'to_crypto_asset_id'='null'::jsonb OR NOT (_payload ? 'to_amount') OR _payload->'to_amount'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for swap';
            END IF;
            _result := budgeting.put__swap_crypto_investment_asset(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _from_amount => (_payload->>'from_amount')::numeric,
                _to_crypto_asset_id => (_payload->>'to_crypto_asset_id')::bigint,
                _to_amount => (_payload->>'to_amount')::numeric,
                _target_investment_account_id => CASE WHEN _payload ? 'target_investment_account_id' THEN (_payload->>'target_investment_account_id')::bigint ELSE NULL END,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _operated_at => _accounting_date,
                _value_in_base => CASE WHEN _payload->>'basis_policy'='carry' THEN _numeric WHEN _payload ? 'value_in_base' THEN (_payload->>'value_in_base')::numeric ELSE NULL END,
                _valuation_source => CASE WHEN _payload->>'basis_policy'='carry' THEN 'carried acquisition cost' WHEN _payload ? 'valuation_source' THEN (_payload->>'valuation_source')::text ELSE NULL END
            );
            IF _payload->>'basis_policy'='carry' THEN
                UPDATE portfolio_events SET metadata=(metadata-'valuation_source'-'valuation_date'-'value_at_swap_in_base')
                    || jsonb_build_object('basis_policy','carry','basis_quality',_summary->>'basis_quality',
                        'realized_in_base',0)
                WHERE linked_operation_id=(_result->>'operation_id')::bigint AND event_type IN ('swap_in','swap_out');
                _result:=_result || jsonb_build_object('basis_policy','carry','carried_cost_basis',_numeric,
                    'basis_quality',_summary->>'basis_quality');
            END IF;
            IF _payload->>'valuation_quality'='estimated' THEN
                UPDATE portfolio_events SET metadata=metadata || jsonb_build_object(
                    'valuation_quality','estimated','basis_quality',CASE WHEN event_type='swap_in' THEN 'estimated' ELSE metadata->>'basis_quality' END)
                WHERE linked_operation_id=(_result->>'operation_id')::bigint AND event_type IN ('swap_in','swap_out');
                _result:=_result || jsonb_build_object('valuation_quality','estimated');
            END IF;
        WHEN 'transfer' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','target_investment_account_id','amount','comment']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for transfer';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'target_investment_account_id') OR _payload->'target_investment_account_id'='null'::jsonb OR NOT (_payload ? 'amount') OR _payload->'amount'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for transfer';
            END IF;
            _result := budgeting.put__transfer_crypto_between_investment_accounts(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _target_investment_account_id => (_payload->>'target_investment_account_id')::bigint,
                _amount => (_payload->>'amount')::numeric,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _operated_at => _accounting_date
            );
        WHEN 'fee' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['source_position_id','quantity','comment','link_protocol_position_id']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for fee';
            END IF;
            IF NOT (_payload ? 'source_position_id') OR _payload->'source_position_id'='null'::jsonb OR NOT (_payload ? 'quantity') OR _payload->'quantity'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for fee';
            END IF;
            _result := budgeting.put__crypto_pay_fee(
                _user_id => _user_id,
                _source_position_id => (_payload->>'source_position_id')::bigint,
                _quantity => (_payload->>'quantity')::numeric,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _operated_at => _accounting_date,
                _link_protocol_position_id => CASE WHEN _payload ? 'link_protocol_position_id' THEN (_payload->>'link_protocol_position_id')::bigint ELSE NULL END
            );
        WHEN 'create_protocol' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['investment_account_id','protocol_name','position_type','asset_symbol','quantity','cost_basis_in_base','current_quantity','current_value_in_base','rewards_claimed_in_base','rewards_unclaimed_in_base','crypto_asset_id','network_code','comment','metadata','source_position_id','secondary_source_position_id','secondary_quantity','borrowed_crypto_asset_id','borrowed_quantity','borrowed_value_in_base']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for create_protocol';
            END IF;
            IF NOT (_payload ? 'investment_account_id') OR _payload->'investment_account_id'='null'::jsonb OR NOT (_payload ? 'protocol_name') OR _payload->'protocol_name'='null'::jsonb OR NOT (_payload ? 'position_type') OR _payload->'position_type'='null'::jsonb OR NOT (_payload ? 'asset_symbol') OR _payload->'asset_symbol'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for create_protocol';
            END IF;
            _result := budgeting.put__create_crypto_protocol_position(
                _user_id => _user_id,
                _investment_account_id => (_payload->>'investment_account_id')::bigint,
                _protocol_name => (_payload->>'protocol_name')::text,
                _position_type => (_payload->>'position_type')::text,
                _asset_symbol => (_payload->>'asset_symbol')::text,
                _quantity => CASE WHEN _payload ? 'quantity' THEN (_payload->>'quantity')::numeric ELSE NULL END,
                _cost_basis_in_base => CASE WHEN _payload ? 'cost_basis_in_base' THEN (_payload->>'cost_basis_in_base')::numeric ELSE NULL END,
                _current_quantity => CASE WHEN _payload ? 'current_quantity' THEN (_payload->>'current_quantity')::numeric ELSE NULL END,
                _current_value_in_base => CASE WHEN _payload ? 'current_value_in_base' THEN (_payload->>'current_value_in_base')::numeric ELSE 0 END,
                _rewards_claimed_in_base => CASE WHEN _payload ? 'rewards_claimed_in_base' THEN (_payload->>'rewards_claimed_in_base')::numeric ELSE 0 END,
                _rewards_unclaimed_in_base => CASE WHEN _payload ? 'rewards_unclaimed_in_base' THEN (_payload->>'rewards_unclaimed_in_base')::numeric ELSE 0 END,
                _crypto_asset_id => CASE WHEN _payload ? 'crypto_asset_id' THEN (_payload->>'crypto_asset_id')::bigint ELSE NULL END,
                _network_code => CASE WHEN _payload ? 'network_code' THEN (_payload->>'network_code')::text ELSE NULL END,
                _deposited_at => _accounting_date,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _metadata => CASE WHEN _payload ? 'metadata' THEN (_payload->'metadata') ELSE '{}'::jsonb END,
                _source_position_id => CASE WHEN _payload ? 'source_position_id' THEN (_payload->>'source_position_id')::bigint ELSE NULL END,
                _secondary_source_position_id => CASE WHEN _payload ? 'secondary_source_position_id' THEN (_payload->>'secondary_source_position_id')::bigint ELSE NULL END,
                _secondary_quantity => CASE WHEN _payload ? 'secondary_quantity' THEN (_payload->>'secondary_quantity')::numeric ELSE NULL END,
                _borrowed_crypto_asset_id => CASE WHEN _payload ? 'borrowed_crypto_asset_id' THEN (_payload->>'borrowed_crypto_asset_id')::bigint ELSE NULL END,
                _borrowed_quantity => CASE WHEN _payload ? 'borrowed_quantity' THEN (_payload->>'borrowed_quantity')::numeric ELSE NULL END,
                _borrowed_value_in_base => CASE WHEN _payload ? 'borrowed_value_in_base' THEN (_payload->>'borrowed_value_in_base')::numeric ELSE NULL END
            );
        WHEN 'top_up_protocol' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','source_position_id','quantity','secondary_source_position_id','secondary_quantity','comment']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for top_up_protocol';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'source_position_id') OR _payload->'source_position_id'='null'::jsonb OR NOT (_payload ? 'quantity') OR _payload->'quantity'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for top_up_protocol';
            END IF;
            _result := budgeting.put__top_up_crypto_protocol_position(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _source_position_id => (_payload->>'source_position_id')::bigint,
                _quantity => (_payload->>'quantity')::numeric,
                _secondary_source_position_id => CASE WHEN _payload ? 'secondary_source_position_id' THEN (_payload->>'secondary_source_position_id')::bigint ELSE NULL END,
                _secondary_quantity => CASE WHEN _payload ? 'secondary_quantity' THEN (_payload->>'secondary_quantity')::numeric ELSE NULL END,
                _operated_at => _accounting_date,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END
            );
        WHEN 'partial_close_protocol' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','principal_qty','rewards_qty','principal_value_in_base','rewards_value_in_base','comment','secondary_principal_qty','secondary_value_in_base','secondary_rewards_qty','secondary_rewards_value_in_base']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for partial_close_protocol';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for partial_close_protocol';
            END IF;
            _result := budgeting.put__partial_close_crypto_protocol_position(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _principal_qty => CASE WHEN _payload ? 'principal_qty' THEN (_payload->>'principal_qty')::numeric ELSE 0 END,
                _rewards_qty => CASE WHEN _payload ? 'rewards_qty' THEN (_payload->>'rewards_qty')::numeric ELSE 0 END,
                _principal_value_in_base => CASE WHEN _payload ? 'principal_value_in_base' THEN (_payload->>'principal_value_in_base')::numeric ELSE NULL END,
                _rewards_value_in_base => CASE WHEN _payload ? 'rewards_value_in_base' THEN (_payload->>'rewards_value_in_base')::numeric ELSE NULL END,
                _returned_at => _accounting_date,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _secondary_principal_qty => CASE WHEN _payload ? 'secondary_principal_qty' THEN (_payload->>'secondary_principal_qty')::numeric ELSE 0 END,
                _secondary_value_in_base => CASE WHEN _payload ? 'secondary_value_in_base' THEN (_payload->>'secondary_value_in_base')::numeric ELSE NULL END,
                _secondary_rewards_qty => CASE WHEN _payload ? 'secondary_rewards_qty' THEN (_payload->>'secondary_rewards_qty')::numeric ELSE 0 END,
                _secondary_rewards_value_in_base => CASE WHEN _payload ? 'secondary_rewards_value_in_base' THEN (_payload->>'secondary_rewards_value_in_base')::numeric ELSE NULL END
            );
        WHEN 'close_protocol' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','current_quantity','current_value_in_base','comment','return_quantity','return_value_in_base','secondary_return_quantity','secondary_return_value_in_base','allocation_policy']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for close_protocol';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for close_protocol';
            END IF;
            _result := budgeting.set__close_crypto_protocol_position(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _withdrawn_at => _accounting_date,
                _current_quantity => CASE WHEN _payload ? 'current_quantity' THEN (_payload->>'current_quantity')::numeric ELSE NULL END,
                _current_value_in_base => CASE WHEN _payload ? 'current_value_in_base' THEN (_payload->>'current_value_in_base')::numeric ELSE NULL END,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _return_quantity => CASE WHEN _payload ? 'return_quantity' THEN (_payload->>'return_quantity')::numeric ELSE NULL END,
                _return_value_in_base => CASE WHEN _payload ? 'return_value_in_base' THEN (_payload->>'return_value_in_base')::numeric ELSE NULL END,
                _secondary_return_quantity => CASE WHEN _payload ? 'secondary_return_quantity' THEN (_payload->>'secondary_return_quantity')::numeric ELSE NULL END,
                _secondary_return_value_in_base => CASE WHEN _payload ? 'secondary_return_value_in_base' THEN (_payload->>'secondary_return_value_in_base')::numeric ELSE NULL END,
                _allocation_policy => COALESCE(_payload->>'allocation_policy','per_leg')
            );
        WHEN 'borrow' THEN
            IF _payload ? 'valuation_quality' AND ((_payload->>'valuation_quality') IS DISTINCT FROM 'estimated'
                OR _payload->>'value_in_base' IS NULL OR NULLIF(btrim(_payload->>'valuation_source'),'') IS NULL) THEN
                RAISE EXCEPTION 'Estimated lending valuation requires amount and source';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','debt_qty','value_in_base','comment','borrowed_crypto_asset_id','valuation_quality','valuation_source']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for borrow';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'debt_qty') OR _payload->'debt_qty'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for borrow';
            END IF;
            _result := budgeting.put__lending_take_more_debt(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _debt_qty => (_payload->>'debt_qty')::numeric,
                _value_in_base => CASE WHEN _payload ? 'value_in_base' THEN (_payload->>'value_in_base')::numeric ELSE NULL END,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _operated_at => _accounting_date,
                _borrowed_crypto_asset_id => CASE WHEN _payload ? 'borrowed_crypto_asset_id' THEN (_payload->>'borrowed_crypto_asset_id')::bigint ELSE NULL END
            );
        WHEN 'repay' THEN
            IF _payload ? 'valuation_quality' AND ((_payload->>'valuation_quality') IS DISTINCT FROM 'estimated'
                OR _payload->>'value_in_base' IS NULL OR NULLIF(btrim(_payload->>'valuation_source'),'') IS NULL) THEN
                RAISE EXCEPTION 'Estimated lending valuation requires amount and source';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','source_position_id','repay_qty','value_in_base','comment','interest_qty','valuation_quality','valuation_source']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for repay';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'source_position_id') OR _payload->'source_position_id'='null'::jsonb OR NOT (_payload ? 'repay_qty') OR _payload->'repay_qty'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for repay';
            END IF;
            _result := budgeting.put__lending_repay_debt(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _source_position_id => (_payload->>'source_position_id')::bigint,
                _repay_qty => (_payload->>'repay_qty')::numeric,
                _value_in_base => CASE WHEN _payload ? 'value_in_base' THEN (_payload->>'value_in_base')::numeric ELSE NULL END,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _operated_at => _accounting_date,
                _interest_qty => CASE WHEN _payload ? 'interest_qty' THEN (_payload->>'interest_qty')::numeric ELSE 0 END
            );
        WHEN 'accrue' THEN
            IF _payload ? 'valuation_quality' AND ((_payload->>'valuation_quality') IS DISTINCT FROM 'estimated'
                OR _payload->>'interest_value_in_base' IS NULL OR NULLIF(btrim(_payload->>'valuation_source'),'') IS NULL) THEN
                RAISE EXCEPTION 'Estimated lending valuation requires amount and source';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','collateral_qty','interest_qty','interest_value_in_base','collateral_before','debt_before','valuation_quality','valuation_source']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for accrue';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'collateral_qty') OR _payload->'collateral_qty'='null'::jsonb OR NOT (_payload ? 'interest_qty') OR _payload->'interest_qty'='null'::jsonb OR NOT (_payload ? 'interest_value_in_base') OR NOT (_payload ? 'collateral_before') OR _payload->'collateral_before'='null'::jsonb OR NOT (_payload ? 'debt_before') OR _payload->'debt_before'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for accrue';
            END IF;
            _result := budgeting.put__lending_accrue(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _collateral_qty => (_payload->>'collateral_qty')::numeric,
                _interest_qty => (_payload->>'interest_qty')::numeric,
                _interest_value_in_base => (_payload->>'interest_value_in_base')::numeric,
                _collateral_before => (_payload->>'collateral_before')::numeric,
                _debt_before => (_payload->>'debt_before')::numeric,
                _external_id => 'source-event:' || _id || ':' || _index,
                _operated_at => _accounting_date
            );
        WHEN 'accrue_interest' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','quantity','value_in_base']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for accrue_interest';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'quantity') OR _payload->'quantity'='null'::jsonb OR NOT (_payload ? 'value_in_base') THEN
                RAISE EXCEPTION 'Missing required argument for accrue_interest';
            END IF;
            _result := budgeting.put__lending_accrue_interest(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _quantity => (_payload->>'quantity')::numeric,
                _value_in_base => (_payload->>'value_in_base')::numeric,
                _external_id => 'source-event:' || _id || ':' || _index,
                _operated_at => _accounting_date
            );
        WHEN 'liquidate' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','collateral_position_id','collateral_qty','debt_qty','interest_qty','collateral_fee_qty','collateral_fee_known','settlement_value_in_base','comment']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for liquidate';
            END IF;
            IF NOT (_payload ? 'position_id') OR _payload->'position_id'='null'::jsonb OR NOT (_payload ? 'collateral_qty') OR _payload->'collateral_qty'='null'::jsonb OR NOT (_payload ? 'debt_qty') OR _payload->'debt_qty'='null'::jsonb THEN
                RAISE EXCEPTION 'Missing required argument for liquidate';
            END IF;
            _result := budgeting.put__lending_liquidate(
                _user_id => _user_id,
                _position_id => (_payload->>'position_id')::bigint,
                _collateral_qty => (_payload->>'collateral_qty')::numeric,
                _debt_qty => (_payload->>'debt_qty')::numeric,
                _external_id => 'source-event:' || _id || ':' || _index,
                _operated_at => _accounting_date,
                _interest_qty => CASE WHEN _payload ? 'interest_qty' THEN (_payload->>'interest_qty')::numeric ELSE 0 END,
                _collateral_fee_qty => CASE WHEN _payload ? 'collateral_fee_qty' THEN (_payload->>'collateral_fee_qty')::numeric ELSE 0 END,
                _settlement_value_in_base => CASE WHEN _payload ? 'settlement_value_in_base' THEN (_payload->>'settlement_value_in_base')::numeric ELSE NULL END,
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END,
                _collateral_position_id => (_payload->>'collateral_position_id')::bigint
            );        ELSE RAISE EXCEPTION 'Unsupported source command kind';
        END CASE;
        IF _kind IN ('borrow','accrue','repay') AND _payload->>'valuation_quality'='estimated' THEN
            UPDATE portfolio_events e SET metadata=e.metadata || jsonb_build_object(
                'valuation_quality','estimated','valuation_source',_payload->>'valuation_source') ||
                CASE WHEN e.metadata->>'entry_value_in_base' IS NOT NULL THEN jsonb_build_object('basis_quality','estimated') ELSE '{}'::jsonb END
            FROM crypto_source_event_links l WHERE l.source_event_id=_id AND l.command_index=_index
                AND l.ledger_table='portfolio_events' AND l.ledger_id=e.id;
            UPDATE crypto_protocol_positions SET metadata=metadata || jsonb_build_object(
                'debt_basis_quality',CASE WHEN metadata->>'debt_cost_basis_in_base' IS NULL THEN 'unknown' ELSE 'estimated' END)
            WHERE id=(_payload->>'position_id')::bigint;
            _result:=_result || jsonb_build_object('valuation_quality','estimated');
            IF _result ? 'metadata' THEN
                _result:=jsonb_set(_result,'{metadata,debt_basis_quality}',to_jsonb((SELECT metadata->>'debt_basis_quality' FROM crypto_protocol_positions WHERE id=(_payload->>'position_id')::bigint)));
            END IF;
        END IF;
        IF _funding_mode THEN
            _funding_audit:=budgeting.put__crypto_funding_components(_user_id,_id,_index,_kind,_payload,_funding_before,_result,_accounting_date);
            _result:=_result||jsonb_build_object('funding',_funding_audit);
        END IF;
        _results := _results || jsonb_build_array(_result);
        _index := _index+1;
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('command_index',command_index,
        'ledger_table',ledger_table,'ledger_id',ledger_id) ORDER BY command_index,ledger_table,ledger_id),'[]'::jsonb)
    INTO _links FROM crypto_source_event_links WHERE source_event_id=_id;
    _result := jsonb_build_object('source_event_id',_id,'results',_results,'links',_links);
    UPDATE crypto_source_events SET result=_result WHERE id=_id;
    PERFORM set_config('budgeting.crypto_source_event_id',COALESCE(_old_source,''),true);
    PERFORM set_config('budgeting.crypto_source_command_index',COALESCE(_old_index,''),true);
    RETURN _result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Invalid source command value';
END
$function$;
