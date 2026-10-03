-- An improvement capitalizes coin cost; a fee is an expense. Both stay linked
-- to the item and use the same FIFO ledger as the collection's payments.
CREATE OR REPLACE FUNCTION budgeting.put__charge_collectible_coin(
    _uid bigint, _pid bigint, _asset bigint, _quantity numeric, _kind text, _day date, _comment text
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE p record; a record; lot record; need numeric; take numeric; cost numeric:=0; part numeric; op bigint; base char(3);
BEGIN
    SET search_path TO budgeting;
    IF _kind NOT IN ('fee','topup') OR _kind IS NULL OR _quantity IS NULL OR _quantity<=0
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
    IF _day<p.opened_at THEN RAISE EXCEPTION 'Дата не может быть раньше получения предмета'; END IF;
    base:=get__owner_base_currency(p.owner_type,p.owner_user_id,p.owner_family_id);
    INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
    VALUES(_uid,p.owner_type,p.owner_user_id,p.owner_family_id,'investment_trade',
        CASE WHEN _kind='fee' THEN 'Комиссия · ' ELSE 'Доплата · ' END||p.title,_day) RETURNING id INTO op;
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
    IF _kind='topup' THEN
        -- Normalize the remaining position to base currency when improving an
        -- item bought for a foreign currency: future partial sales use one unit.
        UPDATE portfolio_positions SET amount_in_currency=COALESCE((metadata->>'amount_in_base')::numeric,0)+cost,
          currency_code=base,metadata=metadata||jsonb_build_object('amount_in_base',COALESCE((metadata->>'amount_in_base')::numeric,0)+cost)
          WHERE id=_pid;
    ELSE
        UPDATE portfolio_positions SET metadata=metadata||jsonb_build_object('fees_in_base',COALESCE((metadata->>'fees_in_base')::numeric,0)+cost) WHERE id=_pid;
    END IF;
    INSERT INTO portfolio_events(position_id,event_type,event_at,amount,currency_code,linked_operation_id,comment,metadata,created_by_user_id)
    VALUES(_pid,CASE WHEN _kind='fee' THEN 'fee' ELSE 'top_up' END,_day,cost,base,op,_comment,
      jsonb_build_object('amount_in_base',cost,
        'paid_crypto',jsonb_build_object('crypto_asset_id',_asset,'quantity',_quantity)),_uid);
    RETURN get__portfolio_position(_uid,_pid);
END $f$;
