DROP FUNCTION IF EXISTS budgeting.put__crypto_fiat_trade;
CREATE FUNCTION budgeting.put__crypto_fiat_trade(
    _user_id bigint, _direction text, _investment_account_id bigint,
    _bank_account_id bigint, _crypto_asset_id bigint, _quantity numeric,
    _fiat_currency_code text, _fiat_amount numeric,
    _comment text DEFAULT NULL, _operated_at date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _account record; _bank record; _asset record; _position record;
    _base char(3); _category bigint; _balance numeric; _summary jsonb;
    _cost numeric; _quality text; _operation bigint; _event bigint;
    _position_id bigint; _event_type text; _sign integer; _metadata jsonb;
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
    -- Foreign-currency proceeds require explicit historical valuation and FX lots.
    -- Never silently substitute the disposed crypto cost for the sale proceeds.
    IF _base IS NULL OR _fiat_currency_code IS DISTINCT FROM _base::text THEN
        RAISE EXCEPTION 'Fiat trade currently requires the owner base currency';
    END IF;
    _category:=budgeting.get__owner_system_category_id(_account.owner_type,_account.owner_user_id,_account.owner_family_id,'Unallocated');
    IF _category IS NULL THEN RAISE EXCEPTION 'Missing Unallocated category'; END IF;
    SELECT * INTO _asset FROM crypto_assets WHERE id=_crypto_asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown crypto asset'; END IF;
    PERFORM 1 FROM current_bank_balances WHERE bank_account_id=_bank_account_id AND currency_code=_base FOR UPDATE;
    SELECT amount INTO _balance FROM current_bank_balances WHERE bank_account_id=_bank_account_id AND currency_code=_base;
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
                close_currency_code=_base WHERE id=_position_id;
        ELSE
            UPDATE portfolio_positions SET quantity=quantity-_quantity,amount_in_currency=0 WHERE id=_position_id;
        END IF;
        _metadata:=jsonb_build_object('consumed_cost_basis',_cost,'basis_quality',_quality,
            'value_in_base',_fiat_amount,'realized_in_base',_fiat_amount-_cost,
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
        VALUES(_operation,_bank_account_id,_base,_sign*_fiat_amount);
    -- Money enters/leaves the budget once. Portfolio sale profit is not a second cash receipt.
    INSERT INTO budget_entries(operation_id,category_id,currency_code,amount)
        VALUES(_operation,_category,_base,_sign*_fiat_amount);
    INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,amount,currency_code,
        linked_operation_id,comment,metadata,created_by_user_id)
    VALUES(_position_id,_event_type,COALESCE(_operated_at,current_date),_quantity,_fiat_amount,_base,
        _operation,_comment,_metadata||jsonb_build_object('action','fiat_'||_direction,'crypto_asset_id',_crypto_asset_id),_user_id)
        RETURNING id INTO _event;
    PERFORM budgeting.put__apply_current_bank_delta(_bank_account_id,_base,_sign*_fiat_amount,_sign*_fiat_amount);
    PERFORM budgeting.put__apply_current_budget_delta(_category,_base,_sign*_fiat_amount);
    RETURN jsonb_build_object('operation_id',_operation,'event_id',_event,'position_id',_position_id,
        'cost_basis',_cost,'basis_quality',_quality,'fiat_amount',_fiat_amount,'base_currency_code',_base,
        'realized_in_base',CASE WHEN _direction='sell' THEN _fiat_amount-_cost ELSE 0 END);
END
$function$;
