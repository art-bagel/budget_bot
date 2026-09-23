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
    _old_source text := current_setting('budgeting.crypto_source_event_id',true);
    _old_index text := current_setting('budgeting.crypto_source_command_index',true);
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO _account FROM bank_accounts WHERE id=_anchor_account_id;
    IF _account.id IS NULL OR NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source journal account';
    END IF;
    IF _account.account_kind<>'investment' OR _account.investment_asset_type<>'crypto' THEN
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
    IF FOUND THEN
        IF _prior.anchor_account_id IS DISTINCT FROM _anchor_account_id
            OR _prior.occurred_at IS DISTINCT FROM _occurred_at
            OR _prior.order_in_timestamp IS DISTINCT FROM _order_in_timestamp
            OR _prior.accounting_date IS DISTINCT FROM _accounting_date
            OR _prior.commands IS DISTINCT FROM _commands OR _prior.evidence IS DISTINCT FROM _evidence THEN
            RAISE EXCEPTION 'Source event already posted with different input; rebuild dependent history';
        END IF;
        RETURN _prior.result;
    END IF;
    IF EXISTS(SELECT 1 FROM crypto_source_events WHERE owner_key=_owner_key
        AND (occurred_at,order_in_timestamp)>=(_occurred_at,_order_in_timestamp)) THEN
        RAISE EXCEPTION 'Source event is out of order; rebuild dependent history';
    END IF;
    INSERT INTO crypto_source_events(owner_key,anchor_account_id,source_namespace,source_id,
        occurred_at,order_in_timestamp,accounting_date,commands,evidence,created_by_user_id)
    VALUES(_owner_key,_anchor_account_id,_source_namespace,_source_id,_occurred_at,
        _order_in_timestamp,_accounting_date,_commands,_evidence,_user_id) RETURNING id INTO _id;
    PERFORM set_config('budgeting.crypto_source_event_id',_id::text,true);
    FOR _command IN SELECT value FROM jsonb_array_elements(_commands) LOOP
        IF jsonb_typeof(_command)<>'object' OR NOT (_command ?& ARRAY['kind','payload'])
            OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('kind','payload'))
            OR jsonb_typeof(_command->'payload')<>'object' THEN
            RAISE EXCEPTION 'Each command requires only kind and payload';
        END IF;
        _kind := _command->>'kind';
        _payload := _command->'payload';
        PERFORM set_config('budgeting.crypto_source_command_index',_index::text,true);
        -- Every referenced account/position must be in the journal owner scope.
        FOREACH _key IN ARRAY ARRAY['position_id','source_position_id','secondary_source_position_id',
            'link_protocol_position_id','investment_account_id','target_investment_account_id'] LOOP
            IF _payload->>_key IS NULL THEN CONTINUE; END IF;
            IF _key IN ('investment_account_id','target_investment_account_id') THEN
                _resource_account := (_payload->>_key)::bigint;
            ELSIF _key='link_protocol_position_id' OR (_key='position_id' AND _kind NOT IN ('swap','transfer')) THEN
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
            IF _payload->>'source_position_id' IS NULL THEN
                RAISE EXCEPTION 'Historical protocol deposit requires a source position';
            END IF;
            IF (_payload->>'current_quantity' IS NOT NULL AND
                (_payload->>'current_quantity')::numeric IS DISTINCT FROM (_payload->>'quantity')::numeric)
                OR COALESCE((_payload->>'rewards_claimed_in_base')::numeric,0)<>0
                OR COALESCE((_payload->>'rewards_unclaimed_in_base')::numeric,0)<>0 THEN
                RAISE EXCEPTION 'Post protocol accruals separately; do not import final balances';
            END IF;
        END IF;
        CASE _kind
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
        WHEN 'bank_buy', 'bank_to_portfolio' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(
                CASE WHEN _kind='bank_buy' THEN ARRAY['bank_account_id','crypto_asset_id','quantity','fiat_currency_code','fiat_amount','comment']
                ELSE ARRAY['bank_account_id','investment_account_id','crypto_asset_id','quantity','comment'] END))) THEN
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
                IF _payload->>'fiat_currency_code' IS DISTINCT FROM
                    budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id)::text THEN
                    RAISE EXCEPTION 'Historical bank buy currently requires base currency';
                END IF;
                _numeric:=(_payload->>'fiat_amount')::numeric;
                IF _numeric<=0 OR _numeric::text IN ('NaN','Infinity','-Infinity') OR _numeric<>round(_numeric,2) THEN
                    RAISE EXCEPTION 'Historical bank purchase amount must be positive exact money';
                END IF;
                _result:=budgeting.put__buy_crypto_asset(_user_id,(_payload->>'bank_account_id')::bigint,
                    (_payload->>'fiat_currency_code')::char(3),_numeric,(_payload->>'crypto_asset_id')::bigint,
                    (_payload->>'quantity')::numeric,_payload->>'comment',_accounting_date);
            ELSE
                _result:=budgeting.put__transfer_crypto_to_investment(_user_id,(_payload->>'bank_account_id')::bigint,
                    (_payload->>'investment_account_id')::bigint,(_payload->>'crypto_asset_id')::bigint,
                    (_payload->>'quantity')::numeric,NULL,NULL,_payload->>'comment',_accounting_date);
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
        WHEN 'reward' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['investment_account_id','crypto_asset_id','quantity','comment']::text[]))) THEN
                RAISE EXCEPTION 'Unsupported argument for reward';
            END IF;
            IF _payload->>'investment_account_id' IS NULL OR _payload->>'crypto_asset_id' IS NULL OR _payload->>'quantity' IS NULL THEN
                RAISE EXCEPTION 'Missing required argument for reward';
            END IF;
            _result := budgeting.put__crypto_receive_reward(_user_id,
                (_payload->>'investment_account_id')::bigint,
                (_payload->>'crypto_asset_id')::bigint,
                (_payload->>'quantity')::numeric, _payload->>'comment', _accounting_date);
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
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','from_amount','to_crypto_asset_id','to_amount','target_investment_account_id','comment','value_in_base','valuation_source']::text[]))) THEN
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
                _value_in_base => CASE WHEN _payload ? 'value_in_base' THEN (_payload->>'value_in_base')::numeric ELSE NULL END,
                _valuation_source => CASE WHEN _payload ? 'valuation_source' THEN (_payload->>'valuation_source')::text ELSE NULL END
            );
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
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','current_quantity','current_value_in_base','comment','return_quantity','return_value_in_base','secondary_return_quantity','secondary_return_value_in_base']::text[]))) THEN
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
                _secondary_return_value_in_base => CASE WHEN _payload ? 'secondary_return_value_in_base' THEN (_payload->>'secondary_return_value_in_base')::numeric ELSE NULL END
            );
        WHEN 'borrow' THEN
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','debt_qty','value_in_base','comment','borrowed_crypto_asset_id']::text[]))) THEN
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
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','source_position_id','repay_qty','value_in_base','comment','interest_qty']::text[]))) THEN
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
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','collateral_qty','interest_qty','interest_value_in_base','collateral_before','debt_before']::text[]))) THEN
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
            IF EXISTS(SELECT 1 FROM jsonb_object_keys(_payload) k WHERE NOT(k=ANY(ARRAY['position_id','collateral_qty','debt_qty','interest_qty','collateral_fee_qty','settlement_value_in_base','comment']::text[]))) THEN
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
                _comment => CASE WHEN _payload ? 'comment' THEN (_payload->>'comment')::text ELSE NULL END
            );        ELSE RAISE EXCEPTION 'Unsupported source command kind';
        END CASE;
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
