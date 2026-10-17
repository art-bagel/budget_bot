-- Deleting journal sources instead of recalculating history, and past dates in
-- posting order (bank model). Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
 uid bigint:=990000000951; other bigint:=990000000952; me jsonb; bank bigint; wallet bigint; coll bigint;
 coin bigint; coin2 bigint; item jsonb; item_b jsonb; item_c jsonb; r jsonb; before jsonb; err text; req uuid; close_req uuid;
 sid bigint; sid_b bigint; sid_sell bigint; sid_c bigint; sid_d bigint; pos bigint; ev record; pay jsonb;
 member bigint:=990000000953; fam jsonb; fcoll bigint; coin3 bigint; cat bigint; e1 jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Undo','Owner');
 PERFORM put__register_user_context(other,'RUB',NULL,'Other','User');
 bank:=(me->>'bank_account_id')::bigint;
 wallet:=(put__create_bank_account(uid,'Wallet','user','investment','crypto')->>'id')::bigint;
 coll:=(put__create_bank_account(uid,'Gifts','user','investment','collectible')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('UNDO','Undo coin','ton','0:undo-coin',9::smallint,'{}'::jsonb)->>'id')::bigint;
 coin2:=(put__ensure_crypto_asset('UNDO2','Undo coin 2','ton','0:undo-coin-2',9::smallint,'{}'::jsonb)->>'id')::bigint;
 PERFORM put__record_income(uid,bank,100000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',10000,coin,100);
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',2000,coin2,20);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',
  jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin,'amount','100'),current_date-10);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',
  jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin2,'amount','10'),current_date-10);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','20','title','Candle','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date-5);

 -- 1. Wrong currency sale (RUB instead of coins) is deleted; state returns exactly.
 before:=get__crypto_correction_state(coll);
 close_req:=gen_random_uuid();
 pay:=jsonb_build_object('position_id',item->'id','close_currency_code','RUB','close_amount_in_currency',26);
 PERFORM put__manual_collectible_movement(uid,close_req,'collectible_fiat_close',pay,current_date);
 sid:=(SELECT id FROM crypto_source_events WHERE source_id=close_req::text);
 ASSERT (SELECT status FROM portfolio_positions WHERE id=(item->>'id')::bigint)='closed','sold for RUB';
 req:=gen_random_uuid();
 BEGIN PERFORM put__delete_crypto_source(other,sid,req); RAISE EXCEPTION 'foreign delete passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','foreign user denied: '||err;
 r:=put__delete_crypto_source(uid,sid,req);
 ASSERT (r->>'deleted')::boolean,'deleted';
 ASSERT get__crypto_correction_state(coll)=before,'state restored exactly';
 ASSERT (SELECT status FROM portfolio_positions WHERE id=(item->>'id')::bigint)='open','item open again';
 ASSERT NOT EXISTS(SELECT 1 FROM crypto_source_events WHERE id=sid),'event gone';
 ASSERT NOT EXISTS(SELECT 1 FROM crypto_source_mutations WHERE source_event_id=sid),'mutations gone';
 ASSERT (SELECT jsonb_array_length(mutations)>0 AND deleted_by_user_id=uid FROM crypto_source_deletions WHERE request_id=req),'audit kept';
 -- 7. Idempotent retry; another user cannot replay the request id.
 ASSERT put__delete_crypto_source(uid,sid,req)=r,'retry same result';
 BEGIN PERFORM put__delete_crypto_source(other,sid,req); RAISE EXCEPTION 'foreign retry passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','foreign retry denied: '||err;
 BEGIN PERFORM put__delete_crypto_source(uid,sid,gen_random_uuid()); RAISE EXCEPTION 'second delete passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Операция уже отменена','already deleted: '||err;
 -- Tombstone: a late retry of the deleted request does not post again.
 BEGIN PERFORM put__manual_collectible_movement(uid,close_req,'collectible_fiat_close',pay,current_date); RAISE EXCEPTION 'tombstone passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Операция была удалена%','tombstone: '||err;

 -- 2. The same sale again, now for coins.
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','26'),current_date);
 ASSERT r->>'status'='closed','sold for coins';

 -- 3. A purchase whose lot and balance a later sale touched cannot be deleted first.
 item_b:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','10','title','Bear','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 sid_b:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',item_b->'id','crypto_asset_id',coin,'crypto_quantity','12'),current_date);
 sid_sell:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 before:=get__crypto_correction_state(coll);
 BEGIN PERFORM put__delete_crypto_source(uid,sid_b,gen_random_uuid()); RAISE EXCEPTION 'dependent delete passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Сначала отмените более поздние операции%collectible_sell%','blocker named: '||err;
 ASSERT get__crypto_correction_state(coll)=before,'blocked delete changes nothing';
 PERFORM put__delete_crypto_source(uid,sid_sell,gen_random_uuid());
 PERFORM put__delete_crypto_source(uid,sid_b,gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE id=(item_b->>'id')::bigint),'purchase undone after the sale';

 -- 4. An earlier source nobody touched later is deletable: different coin, rows disjoint.
 item_c:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin2,'crypto_quantity','1','title','Cap','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 sid_c:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','Hat','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 sid_d:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__delete_crypto_source(uid,sid_c,gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE id=(item_c->>'id')::bigint),'independent earlier source deleted';
 ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin2)=10,'coin2 back';

 -- 5. A write outside the journal blocks the delete and nothing changes.
 pos:=(SELECT id FROM portfolio_positions WHERE investment_account_id=coll AND title='Hat');
 UPDATE portfolio_positions SET metadata=metadata||'{"outside":true}' WHERE id=pos;
 BEGIN PERFORM put__delete_crypto_source(uid,sid_d,gen_random_uuid()); RAISE EXCEPTION 'outside write ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Не отменить: после этой операции предмет или позиция изменён другой операцией%','outside write: '||err;
 ASSERT EXISTS(SELECT 1 FROM crypto_source_events WHERE id=sid_d),'blocked source kept';
 UPDATE portfolio_positions SET metadata=metadata-'outside' WHERE id=pos;
 -- A row outside the journal that hangs off the item would vanish by cascade.
 INSERT INTO portfolio_events(position_id,event_type,event_at,comment,created_by_user_id)
  VALUES(pos,'adjustment',current_date,'outside',uid);
 BEGIN PERFORM put__delete_crypto_source(uid,sid_d,gen_random_uuid()); RAISE EXCEPTION 'cascade ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'На эту операцию опираются%','cascade: '||err;
 DELETE FROM portfolio_events WHERE position_id=pos AND comment='outside';

 -- Money taken out by an ordinary transfer: the cancel would leave the account
 -- short, so it is refused like a reversal; reversing the transfer unblocks.
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','Spent','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',
  jsonb_build_object('position_id',item->'id','close_currency_code','RUB','close_amount_in_currency',26),current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 r:=put__transfer_between_accounts(uid,coll,bank,'RUB',10);
 BEGIN PERFORM put__delete_crypto_source(uid,sid,gen_random_uuid()); RAISE EXCEPTION 'spent money ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Не отменить: на счёте «Gifts» не хватает 10.00 RUB — деньги уже потрачены','spent money: '||err;
 PERFORM put__reverse_operation(uid,(r->>'operation_id')::bigint);
 PERFORM put__delete_crypto_source(uid,sid,gen_random_uuid());
 ASSERT COALESCE((SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB'),0)=0,'sale undone after the transfer was reversed';

 -- 9, 10. Past dates: the operation keeps its date, the posting goes last.
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','5','title','Old','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date-4);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_fee',
  jsonb_build_object('position_id',pos,'crypto_asset_id',coin,'crypto_quantity','1'),current_date);
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',
  jsonb_build_object('position_id',item->'id','close_currency_code','RUB','close_amount_in_currency',300),current_date-2);
 SELECT * INTO ev FROM crypto_source_events WHERE created_by_user_id=uid ORDER BY occurred_at DESC,order_in_timestamp DESC LIMIT 1;
 ASSERT ev.commands->0->>'kind'='collectible_fiat_close','past-dated sale posted last';
 ASSERT (SELECT event_at FROM portfolio_events WHERE position_id=(item->>'id')::bigint AND event_type='close')=current_date-2,'event keeps date';
 ASSERT (SELECT o.operated_on FROM crypto_source_event_links l JOIN operations o ON o.id=l.ledger_id
   WHERE l.source_event_id=ev.id AND l.ledger_table='operations' LIMIT 1)=current_date-2,'operation keeps date';
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','New','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 BEGIN PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',
  jsonb_build_object('position_id',item->'id','close_currency_code','RUB','close_amount_in_currency',1),current_date-1);
  RAISE EXCEPTION 'sale before receipt passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Дата раньше получения%','sale before receipt: '||err;
 BEGIN PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','1'),current_date+5);
  RAISE EXCEPTION 'future date passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Дата операции в будущем','future: '||err;

 -- 11. Crypto movement with a past date after a later one; FIFO in posting order.
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object(
  'bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin2,'amount','5'),current_date);
 pos:=(SELECT id FROM portfolio_positions WHERE investment_account_id=wallet AND status='open');
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object(
  'bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin2,'amount','1'),current_date-3);
 SELECT * INTO ev FROM crypto_source_events WHERE created_by_user_id=uid ORDER BY occurred_at DESC,order_in_timestamp DESC LIMIT 1;
 ASSERT (ev.evidence->>'requested_date')::date=current_date-3 AND ev.accounting_date>=current_date,'crypto past date posted last';

 -- Cancelling a journal operation deletes its source; no reversal row appears.
 r:=put__reverse_operation(uid,(SELECT ledger_id FROM crypto_source_event_links WHERE source_event_id=ev.id AND ledger_table='operations' LIMIT 1));
 ASSERT r->>'reversal_operation_id' IS NULL AND NOT EXISTS(SELECT 1 FROM crypto_source_events WHERE id=ev.id),'cancel deletes source';
 ASSERT (SELECT count(*) FROM operations WHERE type='reversal' AND owner_user_id=uid)=1,'only the ordinary transfer was reversed';

 -- 11. FIFO follows posting order: a past-dated lot posted later is consumed later.
 coin3:=(put__ensure_crypto_asset('UNDO3','Undo coin 3','ton','0:undo-coin-3',9::smallint,'{}'::jsonb)->>'id')::bigint;
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1000,coin3,10);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',
  jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin3,'amount','1'),current_date);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','5','title','Fifo','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date-6);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',item->'id','crypto_asset_id',coin3,'crypto_quantity','1'),current_date-2);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,
  'title','Fee target','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_fee',
  jsonb_build_object('position_id',item->'id','crypto_asset_id',coin3,'crypto_quantity','1'),current_date);
 ASSERT (SELECT (amount,cost_base_remaining)=(1::numeric,500::numeric) FROM current_crypto_balances
  WHERE bank_account_id=coll AND crypto_asset_id=coin3),'fee took the lot posted first (100), the past-dated sale lot (500) stays';

 -- Ordinary expenses of an owner with a journal keep their reversal, in any order.
 cat:=put__create_category(uid,'Food','regular');
 e1:=put__record_expense(uid,bank,cat,50,'RUB');
 PERFORM put__record_expense(uid,bank,cat,70,'RUB');
 ASSERT put__reverse_operation(uid,(e1->>'operation_id')::bigint)->>'reversal_operation_id' IS NOT NULL,'earlier expense reversed';

 -- 6. A family member deletes a family operation; the founder sees the same journal.
 PERFORM put__register_user_context(member,'RUB','undo_member','Family','Member');
 fam:=put__create_family(uid,'Undo family');
 PERFORM set__respond_family_invitation(member,(put__invite_family_member(uid,'undo_member')->>'invitation_id')::bigint,true);
 fcoll:=(put__create_bank_account(uid,'Family gifts','family','investment','collectible')->>'id')::bigint;
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',fcoll,
  'title','Family gift','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE anchor_account_id=fcoll);
 BEGIN PERFORM put__delete_crypto_source(other,sid,gen_random_uuid()); RAISE EXCEPTION 'outsider deleted family operation';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','outsider denied: '||err;
 PERFORM put__delete_crypto_source(member,sid,gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE investment_account_id=fcoll),'member deleted family gift';
END $$;
ROLLBACK;
