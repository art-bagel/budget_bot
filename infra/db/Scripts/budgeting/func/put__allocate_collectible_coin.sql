-- Consume the payment once, then capitalize its basis equally per item unit.
CREATE OR REPLACE FUNCTION budgeting.put__allocate_collectible_coin(
    _uid bigint, _pid bigint, _asset bigint, _quantity numeric, _ids bigint[], _day date, _comment text
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE p record; a record; lot record; need numeric; take numeric; cost numeric:=0; part numeric; op bigint; base char(3); total_units numeric; allocated numeric:=0; allocated_units numeric:=0; share numeric; target record; n integer:=0; cnt integer;
BEGIN
    SET search_path TO budgeting;
    IF _quantity IS NULL OR _quantity<=0
       OR _quantity::text IN ('NaN','Infinity','-Infinity') OR _quantity<>round(_quantity,18) THEN
        RAISE EXCEPTION 'Некорректная сумма или вид списания';
    END IF;
    SELECT * INTO p FROM portfolio_positions WHERE id=_pid FOR UPDATE;
    IF p.id IS NULL OR p.asset_type_code<>'collectible' OR p.status<>'open'
       OR NOT has__owner_access(_uid,p.owner_type,p.owner_user_id,p.owner_family_id) THEN
        RAISE EXCEPTION 'Нет доступа к открытому предмету';
    END IF;
    SELECT * INTO a FROM bank_accounts WHERE id=p.investment_account_id AND is_active FOR UPDATE;
    IF a.id IS NULL OR a.investment_asset_type<>'collectible' THEN RAISE EXCEPTION 'Счёт коллекций недоступен'; END IF;
    IF _day IS NULL OR NOT isfinite(_day) THEN RAISE EXCEPTION 'Некорректная дата'; END IF;
    IF _day<p.opened_at THEN RAISE EXCEPTION 'Дата не может быть раньше получения предмета'; END IF;
    IF cardinality(_ids) IS NULL OR cardinality(_ids)<1 OR cardinality(_ids)>1000
       OR NOT (_pid=ANY(_ids)) OR array_position(_ids,NULL) IS NOT NULL
       OR cardinality(_ids)<>(SELECT count(DISTINCT x) FROM unnest(_ids) x) THEN
        RAISE EXCEPTION 'Выберите предметы без повторений';
    END IF;
    PERFORM 1 FROM portfolio_positions WHERE id=ANY(_ids) ORDER BY id FOR UPDATE;
    IF (SELECT count(*) FROM portfolio_positions WHERE id=ANY(_ids)
        AND investment_account_id=a.id AND asset_type_code='collectible' AND status='open'
        AND opened_at<=_day AND COALESCE(quantity,1)>0)<>cardinality(_ids) THEN
        RAISE EXCEPTION 'Выберите открытые предметы одного счёта, полученные не позже даты затрат';
    END IF;
    SELECT sum(COALESCE(quantity,1)),count(*) INTO total_units,cnt FROM portfolio_positions WHERE id=ANY(_ids);
    base:=get__owner_base_currency(p.owner_type,p.owner_user_id,p.owner_family_id);
    INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
    VALUES(_uid,p.owner_type,p.owner_user_id,p.owner_family_id,'investment_trade',
        'Распределение затрат',_day) RETURNING id INTO op;
    need:=_quantity;
    FOR lot IN SELECT * FROM crypto_lots WHERE bank_account_id=a.id AND crypto_asset_id=_asset AND amount_remaining>0
        AND NOT COALESCE((metadata->>'reserved_for_manual_expense')::boolean,false) ORDER BY created_at,id FOR UPDATE LOOP
        EXIT WHEN need=0;
        take:=least(need,lot.amount_remaining);
        part:=CASE WHEN take=lot.amount_remaining THEN lot.cost_base_remaining ELSE round(lot.cost_base_remaining*take/lot.amount_remaining,2) END;
        UPDATE crypto_lots SET amount_remaining=amount_remaining-take,cost_base_remaining=cost_base_remaining-part WHERE id=lot.id;
        INSERT INTO crypto_lot_consumptions(operation_id,lot_id,amount,cost_base) VALUES(op,lot.id,take,part);
        cost:=cost+part;need:=need-take;
    END LOOP;
    IF need>0 THEN RAISE EXCEPTION 'Недостаточно монет на счёте коллекций'; END IF;
    INSERT INTO crypto_bank_entries(operation_id,bank_account_id,crypto_asset_id,amount) VALUES(op,a.id,_asset,-_quantity);
    PERFORM put__apply_current_crypto_delta(a.id,_asset,-_quantity,-cost);
    FOR target IN SELECT * FROM portfolio_positions WHERE id=ANY(_ids) ORDER BY id LOOP
        n:=n+1;
        allocated_units:=allocated_units+COALESCE(target.quantity,1);
        share:=CASE WHEN n=cnt THEN cost-allocated ELSE round(cost*allocated_units/total_units,2)-allocated END;
        allocated:=allocated+share;
        UPDATE portfolio_positions SET amount_in_currency=COALESCE((metadata->>'amount_in_base')::numeric,0)+share,
          currency_code=base,metadata=metadata||jsonb_build_object('amount_in_base',COALESCE((metadata->>'amount_in_base')::numeric,0)+share)
          WHERE id=target.id;
        INSERT INTO portfolio_events(position_id,event_type,event_at,amount,currency_code,linked_operation_id,comment,metadata,created_by_user_id)
        VALUES(target.id,'top_up',_day,share,base,op,COALESCE(_comment,'Распределение затрат'),
          jsonb_build_object('amount_in_base',share,'allocation',jsonb_build_object(
            'method','equal_per_unit','total_cost_in_base',cost,'item_units',COALESCE(target.quantity,1),
            'total_units',total_units,'payment_crypto_asset_id',_asset,'payment_quantity',_quantity)),_uid);
    END LOOP;
    RETURN get__portfolio_position(_uid,_pid);
END $f$;
