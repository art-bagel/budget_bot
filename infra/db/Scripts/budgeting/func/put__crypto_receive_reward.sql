DROP FUNCTION IF EXISTS budgeting.put__crypto_receive_reward;
CREATE FUNCTION budgeting.put__crypto_receive_reward(
    _user_id bigint, _investment_account_id bigint, _crypto_asset_id bigint,
    _quantity numeric, _comment text DEFAULT NULL, _operated_at date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _account record;
    _asset record;
    _position_id bigint;
    _event_id bigint;
    _base char(3);
BEGIN
    SET search_path TO budgeting;
    IF _quantity IS NULL OR _quantity<=0
        OR _quantity::text IN ('NaN','Infinity','-Infinity') OR _quantity<>round(_quantity,18) THEN
        RAISE EXCEPTION 'Reward quantity must be finite, positive, with at most 18 decimals';
    END IF;
    -- Serialize creation of the first position, including rewards for an asset
    -- never bought before. Existing positions are locked before incrementing.
    SELECT * INTO _account FROM bank_accounts WHERE id=_investment_account_id FOR UPDATE;
    IF _account.id IS NULL OR NOT _account.is_active
        OR _account.account_kind<>'investment' OR _account.investment_asset_type<>'crypto' THEN
        RAISE EXCEPTION 'Reward requires an active crypto investment account';
    END IF;
    IF NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to reward account';
    END IF;
    SELECT * INTO _asset FROM crypto_assets WHERE id=_crypto_asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown reward crypto asset'; END IF;
    _base := budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id);
    IF _base IS NULL THEN RAISE EXCEPTION 'Missing owner base currency'; END IF;
    SELECT id INTO _position_id FROM portfolio_positions
        WHERE investment_account_id=_investment_account_id AND asset_type_code='crypto'
          AND status='open' AND metadata->>'crypto_asset_id'=_crypto_asset_id::text
        FOR UPDATE;
    IF _position_id IS NULL THEN
        INSERT INTO portfolio_positions(owner_type,owner_user_id,owner_family_id,
            investment_account_id,asset_type_code,title,quantity,amount_in_currency,
            currency_code,opened_at,comment,metadata,created_by_user_id)
        VALUES(_account.owner_type,_account.owner_user_id,_account.owner_family_id,
            _investment_account_id,'crypto',_asset.symbol,_quantity,0,_base,
            COALESCE(_operated_at,current_date),NULLIF(btrim(_comment),''),
            jsonb_build_object('crypto_kind','spot','crypto_asset_id',_crypto_asset_id,
                'asset_symbol',_asset.symbol,'asset_name',_asset.name,
                'network_code',_asset.network_code,'contract_address',_asset.contract_address),_user_id)
        RETURNING id INTO _position_id;
    ELSE
        PERFORM budgeting.get__crypto_position_movable_entry_summary(_position_id);
        UPDATE portfolio_positions SET quantity=quantity+_quantity,amount_in_currency=0 WHERE id=_position_id;
    END IF;
    -- A free reward adds units, not invested capital or a fictional cash receipt.
    INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,comment,metadata,created_by_user_id)
    VALUES(_position_id,'income',COALESCE(_operated_at,current_date),_quantity,NULLIF(btrim(_comment),''),
        jsonb_build_object('entry_value_in_base',0,'basis_quality','confirmed_zero',
            'source_kind','reward','income_kind','reward','destination','position'),_user_id)
    RETURNING id INTO _event_id;
    RETURN jsonb_build_object('position_id',_position_id,'event_id',_event_id,
        'entry_value_in_base',0,'basis_quality','confirmed_zero');
END
$function$;
