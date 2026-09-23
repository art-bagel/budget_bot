DROP FUNCTION IF EXISTS budgeting.put__crypto_fiat_trade;
CREATE FUNCTION budgeting.put__crypto_fiat_trade(
    _user_id bigint, _direction text, _investment_account_id bigint,
    _bank_account_id bigint, _crypto_asset_id bigint, _quantity numeric,
    _fiat_currency_code text, _fiat_amount numeric,
    _comment text DEFAULT NULL, _operated_at date DEFAULT NULL,
    _historical_value_in_base numeric DEFAULT NULL, _valuation_source text DEFAULT NULL,
    _defer_manual_expense boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _account record; _bank record; _asset record; _position record;
    _base char(3); _category bigint; _balance numeric; _summary jsonb;
    _cost numeric; _quality text; _operation bigint; _event bigint;
    _position_id bigint; _event_type text; _sign integer; _metadata jsonb;
    _value numeric; _foreign boolean; _lot bigint;
BEGIN
    SET search_path TO budgeting;
    IF _direction IS NULL OR _direction NOT IN ('buy','sell') THEN
        RAISE EXCEPTION 'Unsupported fiat trade direction';
    END IF;
    IF _quantity IS NULL OR _quantity::text IN ('NaN','Infinity','-Infinity')
        OR _quantity<=0 OR _quantity<>round(_quantity,18)
        OR _fiat_amount IS NULL OR _fiat_amount::text IN ('NaN','Infinity','-Infinity')
        OR _fiat_amount<=0 OR _fiat_amount<>round(_fiat_amount,2) THEN
        RAISE EXCEPTION 'Trade requires positive exact quantities and a monetary amount to 2 decimals';
    END IF;
    IF _defer_manual_expense IS NULL OR (_defer_manual_expense AND _direction<>'sell') THEN
        RAISE EXCEPTION 'Only sale proceeds can await manual expense';
    END IF;
    -- Shared account order serializes first-position creation and opposite trades.
    PERFORM id FROM bank_accounts WHERE id IN (_investment_account_id,_bank_account_id)
        ORDER BY id FOR UPDATE;
    SELECT * INTO _account FROM bank_accounts WHERE id=_investment_account_id;
    SELECT * INTO _bank FROM bank_accounts WHERE id=_bank_account_id;
    IF _account.id IS NULL OR _bank.id IS NULL OR NOT _account.is_active OR NOT _bank.is_active
        OR _account.account_kind<>'investment' OR _account.investment_asset_type<>'crypto'
        OR _bank.account_kind<>'cash' THEN
        RAISE EXCEPTION 'Trade requires active crypto investment and cash accounts';
    END IF;
    IF _account.owner_type IS DISTINCT FROM _bank.owner_type
        OR _account.owner_user_id IS DISTINCT FROM _bank.owner_user_id
        OR _account.owner_family_id IS DISTINCT FROM _bank.owner_family_id
        OR NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Trade accounts must belong to the same accessible owner';
    END IF;
    _base:=budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id);
    IF _base IS NULL OR _fiat_currency_code IS NULL OR NOT EXISTS (
        SELECT 1 FROM currencies WHERE code::text=_fiat_currency_code
    ) THEN RAISE EXCEPTION 'Unknown fiat currency'; END IF;
    _foreign:=_fiat_currency_code<>_base::text;
    _value:=_fiat_amount;
    IF _foreign THEN
        IF _direction<>'sell' THEN RAISE EXCEPTION 'Foreign currency crypto purchase is not supported'; END IF;
        IF _historical_value_in_base IS NULL
            OR _historical_value_in_base::text IN ('NaN','Infinity','-Infinity')
            OR _historical_value_in_base<=0
            OR _historical_value_in_base<>round(_historical_value_in_base,2)
            OR NULLIF(btrim(_valuation_source),'') IS NULL
            OR round(_historical_value_in_base/_fiat_amount,8)<=0 THEN
            RAISE EXCEPTION 'Foreign proceeds require a positive historical base value and valuation source';
        END IF;
        _value:=_historical_value_in_base;
    ELSIF _historical_value_in_base IS NOT NULL OR _valuation_source IS NOT NULL THEN
        RAISE EXCEPTION 'Base currency trade needs no foreign valuation';
    END IF;
    _category:=budgeting.get__owner_system_category_id(_account.owner_type,_account.owner_user_id,_account.owner_family_id,'Unallocated');
    IF _category IS NULL THEN RAISE EXCEPTION 'Missing Unallocated category'; END IF;
    SELECT * INTO _asset FROM crypto_assets WHERE id=_crypto_asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown crypto asset'; END IF;
    PERFORM 1 FROM current_bank_balances WHERE bank_account_id=_bank_account_id AND currency_code=_fiat_currency_code FOR UPDATE;
    SELECT amount INTO _balance FROM current_bank_balances WHERE bank_account_id=_bank_account_id AND currency_code=_fiat_currency_code;
    IF _direction='buy' AND COALESCE(_balance,0)<_fiat_amount THEN
        RAISE EXCEPTION 'Insufficient cash for crypto purchase';
    END IF;
    SELECT * INTO _position FROM portfolio_positions WHERE investment_account_id=_investment_account_id
        AND asset_type_code='crypto' AND status='open' AND metadata->>'crypto_asset_id'=_crypto_asset_id::text FOR UPDATE;
    _position_id:=_position.id;
    IF _position_id IS NOT NULL THEN
        _summary:=budgeting.get__crypto_position_movable_entry_summary(_position_id);
    END IF;
    IF _direction='sell' THEN
        IF _position_id IS NULL OR _position.quantity<_quantity THEN
            RAISE EXCEPTION 'Insufficient crypto for sale';
        END IF;
        _cost:=round((_summary->>'remaining_cost_basis')::numeric*_quantity/_position.quantity,2);
        _quality:=_summary->>'basis_quality';
        _event_type:='partial_close';
        IF _position.quantity=_quantity THEN
            _event_type:='close';
            UPDATE portfolio_positions SET quantity=0,amount_in_currency=0,status='closed',
                closed_at=COALESCE(_operated_at,current_date),close_amount_in_currency=_fiat_amount,
                close_currency_code=_fiat_currency_code WHERE id=_position_id;
        ELSE
            UPDATE portfolio_positions SET quantity=quantity-_quantity,amount_in_currency=0 WHERE id=_position_id;
        END IF;
        _metadata:=jsonb_build_object('consumed_cost_basis',_cost,'basis_quality',_quality,
            'value_in_base',_value,'realized_in_base',_value-_cost,
            'valuation_source',_valuation_source,'valuation_date',COALESCE(_operated_at,current_date),
            'target_kind','bank','target_bank_account_id',_bank_account_id);
        _sign:=1;
    ELSE
        _cost:=_fiat_amount; _quality:='known'; _event_type:='top_up'; _sign:=-1;
        IF _position_id IS NULL THEN
            _event_type:='open';
            INSERT INTO portfolio_positions(owner_type,owner_user_id,owner_family_id,investment_account_id,
                asset_type_code,title,quantity,amount_in_currency,currency_code,opened_at,metadata,created_by_user_id)
            VALUES(_account.owner_type,_account.owner_user_id,_account.owner_family_id,_investment_account_id,
                'crypto',_asset.symbol,_quantity,0,_base,COALESCE(_operated_at,current_date),
                jsonb_build_object('crypto_kind','spot','crypto_asset_id',_crypto_asset_id,'asset_symbol',_asset.symbol,
                    'asset_name',_asset.name,'network_code',_asset.network_code,'contract_address',_asset.contract_address),_user_id)
            RETURNING id INTO _position_id;
        ELSE
            UPDATE portfolio_positions SET quantity=quantity+_quantity,amount_in_currency=0 WHERE id=_position_id;
        END IF;
        _metadata:=jsonb_build_object('entry_value_in_base',_cost,'basis_quality','known',
            'source_kind','bank','source_bank_account_id',_bank_account_id);
    END IF;
    INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
    VALUES(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id,'investment_trade',
        _comment,COALESCE(_operated_at,current_date)) RETURNING id INTO _operation;
    INSERT INTO bank_entries(operation_id,bank_account_id,currency_code,amount)
        VALUES(_operation,_bank_account_id,_fiat_currency_code,_sign*_fiat_amount);
    IF _foreign THEN
        INSERT INTO fx_lots(bank_account_id,currency_code,amount_initial,amount_remaining,
            buy_rate_in_base,cost_base_initial,cost_base_remaining,opened_by_operation_id)
        VALUES(_bank_account_id,_fiat_currency_code,_fiat_amount,_fiat_amount,
            round(_value/_fiat_amount,8),_value,_value,_operation) RETURNING id INTO _lot;
    END IF;
    -- Money enters/leaves the budget once. Portfolio sale profit is not a second cash receipt.
    INSERT INTO budget_entries(operation_id,category_id,currency_code,amount)
        VALUES(_operation,_category,_base,_sign*_value);
    INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,amount,currency_code,
        linked_operation_id,comment,metadata,created_by_user_id)
    VALUES(_position_id,_event_type,COALESCE(_operated_at,current_date),_quantity,_fiat_amount,_fiat_currency_code,
        _operation,_comment,_metadata||jsonb_build_object('action','fiat_'||_direction,'crypto_asset_id',_crypto_asset_id,'fx_lot_id',_lot,'pending_manual_expense',_defer_manual_expense),_user_id)
        RETURNING id INTO _event;
    PERFORM budgeting.put__apply_current_bank_delta(_bank_account_id,_fiat_currency_code,_sign*_fiat_amount,_sign*_value);
    PERFORM budgeting.put__apply_current_budget_delta(_category,_base,_sign*_value);
    RETURN jsonb_build_object('operation_id',_operation,'event_id',_event,'position_id',_position_id,
        'cost_basis',_cost,'basis_quality',_quality,'fiat_amount',_fiat_amount,'base_currency_code',_base,
        'fiat_currency_code',_fiat_currency_code,'value_in_base',_value,'fx_lot_id',_lot,
        'realized_in_base',CASE WHEN _direction='sell' THEN _value-_cost ELSE 0 END);
END
$function$;
