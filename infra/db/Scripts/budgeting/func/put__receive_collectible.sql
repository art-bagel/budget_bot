-- Explicitly free receipt. Unknown acquisition cost is not a free receipt.
CREATE OR REPLACE FUNCTION budgeting.put__receive_collectible(
    _uid bigint, _account bigint, _title text, _quantity numeric, _day date, _comment text, _metadata jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a record; pid bigint; op bigint; base char(3); m jsonb;
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO a FROM bank_accounts WHERE id=_account AND is_active FOR UPDATE;
    IF a.id IS NULL OR a.investment_asset_type IS DISTINCT FROM 'collectible'
       OR NOT has__owner_access(_uid,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к счёту коллекций';
    END IF;
    IF NULLIF(btrim(_title),'') IS NULL OR _quantity IS NULL OR _quantity<=0
       OR _quantity::text IN ('NaN','Infinity','-Infinity') OR _quantity<>round(_quantity,8) THEN
        RAISE EXCEPTION 'Укажите название и положительное количество предметов';
    END IF;
    base:=get__owner_base_currency(a.owner_type,a.owner_user_id,a.owner_family_id);
    m:=calc__collectible_metadata(_metadata)||jsonb_build_object('amount_in_base',0,'acquisition_kind','free');
    INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
    VALUES(_uid,a.owner_type,a.owner_user_id,a.owner_family_id,'investment_trade','Бесплатное получение · '||btrim(_title),_day) RETURNING id INTO op;
    INSERT INTO portfolio_positions(owner_type,owner_user_id,owner_family_id,investment_account_id,asset_type_code,
        title,quantity,amount_in_currency,currency_code,opened_at,comment,metadata,created_by_user_id)
    VALUES(a.owner_type,a.owner_user_id,a.owner_family_id,a.id,'collectible',btrim(_title),_quantity,0,base,_day,_comment,m,_uid)
    RETURNING id INTO pid;
    INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,amount,currency_code,linked_operation_id,comment,metadata,created_by_user_id)
    VALUES(pid,'open',_day,_quantity,0,base,op,_comment,m,_uid);
    RETURN get__portfolio_position(_uid,pid);
END $f$;
