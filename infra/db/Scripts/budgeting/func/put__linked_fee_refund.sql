CREATE OR REPLACE FUNCTION budgeting.put__linked_fee_refund(_uid bigint,_p jsonb,_day date)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE e record; p record; refunded numeric; returned_cost numeric; remaining numeric;
 cost numeric; qty numeric; units jsonb; result jsonb; quality text;
BEGIN
 SET search_path TO budgeting;
 IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Возврат комиссии требует журнала операций'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('source_position_id','fee_event_id','quantity','comment')) THEN
  RAISE EXCEPTION 'Недопустимые поля возврата комиссии'; END IF;
 qty:=(_p->>'quantity')::numeric;
 IF qty IS NULL OR qty<=0 OR qty::text IN ('NaN','Infinity','-Infinity') OR qty<>round(qty,18) THEN
  RAISE EXCEPTION 'Укажите положительное количество с точностью до 18 знаков'; END IF;
 SELECT * INTO e FROM portfolio_events WHERE id=(_p->>'fee_event_id')::bigint FOR UPDATE;
 SELECT * INTO p FROM portfolio_positions WHERE id=e.position_id FOR UPDATE;
 IF e.id IS NULL OR e.event_type<>'fee' OR e.position_id IS DISTINCT FROM (_p->>'source_position_id')::bigint
  OR p.asset_type_code<>'crypto' OR NOT has__owner_access(_uid,p.owner_type,p.owner_user_id,p.owner_family_id) THEN
  RAISE EXCEPTION 'Комиссия недоступна'; END IF;
 IF _day IS NULL OR _day<e.event_at THEN RAISE EXCEPTION 'Возврат не может предшествовать комиссии'; END IF;
 -- Old pooled refunds have no allocation to a specific fee. Never invent one.
 IF EXISTS(SELECT 1 FROM portfolio_events r JOIN portfolio_positions rp ON rp.id=r.position_id
  WHERE rp.investment_account_id=p.investment_account_id AND rp.metadata->>'crypto_asset_id'=p.metadata->>'crypto_asset_id'
  AND r.metadata->>'source_kind'='fee_refund' AND NOT(r.metadata ? 'fee_event_id') AND r.id>e.id) THEN
  RAISE EXCEPTION 'После этой комиссии уже был общий возврат без связи с конкретной операцией. Нужна сверка прежних возвратов'; END IF;
 SELECT COALESCE(sum(quantity),0),COALESCE(sum((metadata->>'entry_value_in_base')::numeric),0)
 INTO refunded,returned_cost FROM portfolio_events WHERE metadata->>'fee_event_id'=e.id::text AND metadata->>'source_kind'='fee_refund';
 remaining:=e.quantity-refunded;
 IF remaining IS NULL OR qty>remaining THEN RAISE EXCEPTION 'Сумма превышает невозвращённую комиссию'; END IF;
 cost:=(e.metadata->>'consumed_cost_basis')::numeric+COALESCE((e.metadata->>'funding_confirmed_cost')::numeric,0)-returned_cost;
 IF cost IS NULL OR cost<0 THEN RAISE EXCEPTION 'Стоимость комиссии требует уточнения'; END IF;
 cost:=CASE WHEN qty=remaining THEN cost ELSE round(cost*qty/remaining,2) END;
 units:=budgeting.calc__crypto_funding_units('{}',COALESCE(e.metadata->'funding_units','{}'),qty/remaining);
 quality:=CASE WHEN e.metadata->>'basis_quality'='estimated' OR COALESCE((e.metadata->>'funding_confirmed_cost')::numeric,0)>0 THEN 'estimated' WHEN cost=0 THEN 'confirmed_zero' ELSE 'known' END;
 result:=budgeting.put__crypto_receive_reward(_uid,p.investment_account_id,(p.metadata->>'crypto_asset_id')::bigint,qty,COALESCE(_p->>'comment','Возврат комиссии'),_day);
 UPDATE portfolio_events SET event_type='top_up',metadata=(metadata-'income_kind')||jsonb_build_object(
  'source_kind','fee_refund','fee_event_id',e.id,'allocation_policy','linked_historical_fee_cost',
  'entry_value_in_base',cost,'basis_quality',quality,'funding_units_moved',units)
 WHERE id=(result->>'event_id')::bigint;
 UPDATE portfolio_events SET metadata=jsonb_set(metadata,'{funding_units}',
  budgeting.calc__crypto_funding_units(COALESCE(metadata->'funding_units','{}'),units,-1)) WHERE id=e.id;
 UPDATE portfolio_positions SET metadata=jsonb_set(metadata,'{funding_units}',
  budgeting.calc__crypto_funding_units(COALESCE(metadata->'funding_units','{}'),units)) WHERE id=(result->>'position_id')::bigint;
 RETURN result||jsonb_build_object('entry_value_in_base',cost,'basis_quality',quality,'fee_event_id',e.id);
END
$f$;
