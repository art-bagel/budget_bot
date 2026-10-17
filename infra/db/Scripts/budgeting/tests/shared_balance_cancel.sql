-- Cancelling a journal operation when later operations changed only a shared
-- balance (current_*_balances): its own rows go back, its contribution is
-- subtracted from the balance. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;

-- Balance rows that differ from the entries and lots they are derived from
-- (the formulas of rebuild_current_balances), for one owner's accounts.
CREATE FUNCTION pg_temp.drift(_uid bigint) RETURNS bigint LANGUAGE sql AS $$
 WITH acc AS (SELECT id FROM budgeting.bank_accounts WHERE owner_user_id=_uid),
 ce AS (SELECT bank_account_id a,crypto_asset_id k,sum(amount) s FROM budgeting.crypto_bank_entries WHERE bank_account_id IN (SELECT id FROM acc) GROUP BY 1,2),
 cl AS (SELECT bank_account_id a,crypto_asset_id k,sum(cost_base_remaining) c FROM budgeting.crypto_lots WHERE amount_remaining>0 AND bank_account_id IN (SELECT id FROM acc) GROUP BY 1,2),
 cc AS (SELECT * FROM budgeting.current_crypto_balances WHERE bank_account_id IN (SELECT id FROM acc)),
 be AS (SELECT bank_account_id a,currency_code k,sum(amount) s FROM budgeting.bank_entries WHERE bank_account_id IN (SELECT id FROM acc) GROUP BY 1,2),
 bc AS (SELECT * FROM budgeting.current_bank_balances WHERE bank_account_id IN (SELECT id FROM acc)),
 ge AS (SELECT category_id a,currency_code k,sum(amount) s FROM budgeting.budget_entries WHERE category_id IN (SELECT id FROM budgeting.categories WHERE owner_user_id=_uid) GROUP BY 1,2),
 gc AS (SELECT * FROM budgeting.current_budget_balances WHERE category_id IN (SELECT id FROM budgeting.categories WHERE owner_user_id=_uid))
 SELECT (SELECT count(*) FROM ce FULL JOIN cc ON cc.bank_account_id=ce.a AND cc.crypto_asset_id=ce.k
          LEFT JOIN cl ON cl.a=COALESCE(ce.a,cc.bank_account_id) AND cl.k=COALESCE(ce.k,cc.crypto_asset_id)
          WHERE COALESCE(cc.amount,0)<>COALESCE(ce.s,0) OR COALESCE(cc.cost_base_remaining,0)<>COALESCE(cl.c,0))
      + (SELECT count(*) FROM be FULL JOIN bc ON bc.bank_account_id=be.a AND bc.currency_code=be.k
          WHERE COALESCE(bc.amount,0)<>COALESCE(be.s,0))
      + (SELECT count(*) FROM ge FULL JOIN gc ON gc.category_id=ge.a AND gc.currency_code=ge.k
          WHERE COALESCE(gc.amount,0)<>COALESCE(ge.s,0))
$$;

DO $$
DECLARE
 uid bigint:=990000000961; me jsonb; bank bigint; free bigint; coll bigint; wallet bigint; cat bigint;
 coin bigint; coin2 bigint; mfrom bigint; mto bigint;
 a jsonb; b jsonb; c jsonb; d jsonb; e jsonb; r jsonb; err text; before jsonb; mid jsonb;
 x1 bigint; x2 bigint; x3 bigint; x5 bigint; x6 bigint; xr bigint; xw bigint; xm bigint; pos bigint; spare numeric;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Shared','Owner');
 bank:=(me->>'bank_account_id')::bigint;
 free:=(me->>'unallocated_category_id')::bigint;
 coll:=(put__create_bank_account(uid,'Коллекции','user','investment','collectible')->>'id')::bigint;
 wallet:=(put__create_bank_account(uid,'Кошелёк','user','investment','crypto')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('SGRAM','Shared coin','ton','0:shared-coin',9::smallint,'{}'::jsonb)->>'id')::bigint;
 coin2:=(put__ensure_crypto_asset('SGRAM2','Shared coin 2','ton','0:shared-coin-2',9::smallint,'{}'::jsonb)->>'id')::bigint;
 PERFORM put__record_income(uid,bank,100000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',3000,coin,30);     -- 100 per coin
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',
  jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin,'amount','30'),current_date);
 a:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','10','title','A','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 b:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','5','title','B','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 ASSERT (SELECT (amount,cost_base_remaining)=(15::numeric,1500::numeric) FROM current_crypto_balances
  WHERE bank_account_id=coll AND crypto_asset_id=coin),'setup: 15 coins at 1500';

 -- 1, 2, 8. Two sales for the same coin: the earlier one is cancelled first,
 -- then the later one; the state is as before both, in either order.
 before:=get__crypto_correction_state(coll);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',a->'id','crypto_asset_id',coin,'crypto_quantity','20'),current_date);
 x1:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',b->'id','crypto_asset_id',coin,'crypto_quantity','8'),current_date);
 x2:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 -- 10. The check answers like the cancel and changes nothing.
 mid:=get__crypto_correction_state(coll);
 r:=get__operation_cancel_check(uid,NULL,x1);
 ASSERT (r->>'can_cancel')::boolean,'check: earlier sale cancellable '||r::text;
 ASSERT get__crypto_correction_state(coll)=mid,'check changes nothing';
 PERFORM put__delete_crypto_source(uid,x1,gen_random_uuid());
 ASSERT (SELECT status FROM portfolio_positions WHERE id=(a->>'id')::bigint)='open','A open again';
 ASSERT (SELECT status FROM portfolio_positions WHERE id=(b->>'id')::bigint)='closed','B stays sold';
 ASSERT NOT EXISTS(SELECT 1 FROM crypto_lots WHERE metadata->>'position_id'=a->>'id'),'lot of the cancelled sale gone';
 ASSERT (SELECT (amount_remaining,cost_base_remaining)=(8::numeric,500::numeric) FROM crypto_lots
  WHERE metadata->>'position_id'=b->>'id'),'lot of the later sale untouched';
 ASSERT (SELECT (amount,cost_base_remaining)=(23::numeric,2000::numeric) FROM current_crypto_balances
  WHERE bank_account_id=coll AND crypto_asset_id=coin),'balance minus the cancelled sale';
 ASSERT pg_temp.drift(uid)=0,'balances match entries after the first cancel';
 PERFORM put__delete_crypto_source(uid,x2,gen_random_uuid());
 ASSERT get__crypto_correction_state(coll)=before,'both sales undone';
 ASSERT pg_temp.drift(uid)=0,'balances match entries after the second cancel';
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',a->'id','crypto_asset_id',coin,'crypto_quantity','20'),current_date);
 x1:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',b->'id','crypto_asset_id',coin,'crypto_quantity','8'),current_date);
 x2:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__delete_crypto_source(uid,x2,gen_random_uuid());
 PERFORM put__delete_crypto_source(uid,x1,gen_random_uuid());
 ASSERT get__crypto_correction_state(coll)=before,'reverse order: both sales undone';

 -- 5. A purchase with coins, then only a sale: the purchase is cancellable and
 -- the coins it spent come back to their lot.
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','3','title','C','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 x3:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',b->'id','crypto_asset_id',coin,'crypto_quantity','8'),current_date);
 PERFORM put__delete_crypto_source(uid,x3,gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE investment_account_id=coll AND title='C'),'C undone';
 ASSERT (SELECT (amount,cost_base_remaining)=(23::numeric,2000::numeric) FROM current_crypto_balances
  WHERE bank_account_id=coll AND crypto_asset_id=coin),'spent coins back';
 ASSERT pg_temp.drift(uid)=0,'balances match entries after cancelling the purchase';

 -- 12. A purchase that spent coins, then a later spend of the same coin on the
 -- same account from the next lot: blocked, so later costs never shift.
 d:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','15','title','D','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 x5:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 e:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','2','title','E','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 x6:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 ASSERT (SELECT amount_in_currency FROM portfolio_positions WHERE id=(e->>'id')::bigint)=125,'E paid from the sale lot (500/8 each)';
 mid:=get__crypto_correction_state(coll);
 BEGIN PERFORM put__delete_crypto_source(uid,x5,gen_random_uuid()); RAISE EXCEPTION 'later spend ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Сначала отмените более поздние операции%«E»%','later spend named: '||err;
 ASSERT get__crypto_correction_state(coll)=mid,'blocked cancel changes nothing';
 r:=get__operation_cancel_check(uid,NULL,x5);
 ASSERT NOT (r->>'can_cancel')::boolean AND r->>'reason'=err,'check gives the same reason';
 PERFORM put__delete_crypto_source(uid,x6,gen_random_uuid());
 PERFORM put__delete_crypto_source(uid,x5,gen_random_uuid());
 ASSERT pg_temp.drift(uid)=0,'balances match entries after cancelling both purchases';

 -- 4. A later spend that takes this operation's own lot keeps the old refusal.
 c:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,
  'title','Fee target','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',a->'id','crypto_asset_id',coin2,'crypto_quantity','4'),current_date);
 xr:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_fee',
  jsonb_build_object('position_id',c->'id','crypto_asset_id',coin2,'crypto_quantity','1'),current_date);
 BEGIN PERFORM put__delete_crypto_source(uid,xr,gen_random_uuid()); RAISE EXCEPTION 'own lot spend ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Сначала отмените более поздние операции%collectible_coin_fee%','own lot blocker: '||err;

 -- 6. Rubles have no lots: an ordinary transfer out does not block while the
 -- money is still there; when it is spent the refusal names the shortfall.
 c:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','F','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 d:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','G','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',
  jsonb_build_object('position_id',c->'id','close_currency_code','RUB','close_amount_in_currency',1000),current_date);
 x1:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',
  jsonb_build_object('position_id',d->'id','close_currency_code','RUB','close_amount_in_currency',500),current_date);
 x2:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__transfer_between_accounts(uid,coll,bank,'RUB',300);
 PERFORM put__delete_crypto_source(uid,x1,gen_random_uuid());
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB')=200,'1500 - 300 - 1000';
 PERFORM put__transfer_between_accounts(uid,coll,bank,'RUB',200);
 BEGIN PERFORM put__delete_crypto_source(uid,x2,gen_random_uuid()); RAISE EXCEPTION 'spent rubles ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Не отменить: на счёте «Коллекции» не хватает 500.00 RUB — деньги уже потрачены','ruble shortfall: '||err;
 ASSERT pg_temp.drift(uid)=0,'balances match entries after the ruble cancel';

 -- Coins: a lot nobody touched cannot be short, so the balance check is a
 -- guard. A planted gap below the contribution is refused, not hidden.
 c:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','H','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 d:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','I','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',c->'id','crypto_asset_id',coin,'crypto_quantity','2'),current_date);
 x1:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',d->'id','crypto_asset_id',coin,'crypto_quantity','2'),current_date);
 x2:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 spare:=(SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin);
 UPDATE current_crypto_balances SET amount=1.2 WHERE bank_account_id=coll AND crypto_asset_id=coin;
 BEGIN PERFORM put__delete_crypto_source(uid,x1,gen_random_uuid()); RAISE EXCEPTION 'coin shortfall ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Не отменить: на счёте «Коллекции» не хватает 0.8 SGRAM — монеты уже потрачены','coin shortfall: '||err;
 UPDATE current_crypto_balances SET amount=spare WHERE bank_account_id=coll AND crypto_asset_id=coin;

 -- 9. An old gap between a balance and its entries does not block and is
 -- neither fixed nor widened by the cancel.
 UPDATE current_crypto_balances SET cost_base_remaining=cost_base_remaining+1 WHERE bank_account_id=coll AND crypto_asset_id=coin;
 PERFORM put__delete_crypto_source(uid,x1,gen_random_uuid());
 ASSERT (SELECT b.cost_base_remaining-(SELECT sum(cost_base_remaining) FROM crypto_lots l
   WHERE l.bank_account_id=coll AND l.crypto_asset_id=coin AND l.amount_remaining>0)
  FROM current_crypto_balances b WHERE b.bank_account_id=coll AND b.crypto_asset_id=coin)=1,'old gap kept as is';
 UPDATE current_crypto_balances SET cost_base_remaining=cost_base_remaining-1 WHERE bank_account_id=coll AND crypto_asset_id=coin;

 -- An inactive account keeps the strict rule: its balance must be untouched.
 c:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','1','title','J','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',c->'id','crypto_asset_id',coin,'crypto_quantity','2'),current_date);
 UPDATE bank_accounts SET is_active=false WHERE id=coll;
 BEGIN PERFORM put__delete_crypto_source(uid,x2,gen_random_uuid()); RAISE EXCEPTION 'inactive account relaxed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Не отменить: после этой операции остаток монет изменён%','inactive account: '||err;
 UPDATE bank_accounts SET is_active=true WHERE id=coll;
 PERFORM put__delete_crypto_source(uid,x2,gen_random_uuid());
 ASSERT pg_temp.drift(uid)=0,'balances match entries after the coin cancels';

 -- 7. The free budget (Unallocated with FX Result) must cover the cancel.
 cat:=put__create_category(uid,'Food','regular');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1000,coin2,10);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object(
  'bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin2,'amount','10'));
 pos:=(SELECT id FROM portfolio_positions WHERE investment_account_id=wallet AND status='open');
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_withdraw',jsonb_build_object(
  'position_id',pos,'bank_account_id',bank,'amount','10'));
 xw:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 ASSERT EXISTS(SELECT 1 FROM crypto_source_mutations WHERE source_event_id=xw AND table_name='current_budget_balances'),'withdrawal fills the free budget';
 spare:=(SELECT sum(amount) FROM current_budget_balances WHERE currency_code='RUB'
  AND category_id IN (free,get__owner_system_category_id('user',uid,NULL,'FX Result')))-500;
 PERFORM put__allocate_budget(uid,free,cat,spare);
 BEGIN PERFORM put__delete_crypto_source(uid,xw,gen_random_uuid()); RAISE EXCEPTION 'spent budget ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Не отменить: в свободном остатке не хватает 500.00 RUB','budget shortfall: '||err;
 PERFORM put__allocate_budget(uid,cat,free,spare);
 PERFORM put__delete_crypto_source(uid,xw,gen_random_uuid());
 ASSERT pg_temp.drift(uid)=0,'balances match entries after the budget cancel';

 -- 13. A later merge of the coin blocks: the cancel would revive the old coin.
 mfrom:=(put__ensure_crypto_asset('SMRG','Merge coin','ton','',9::smallint,'{}'::jsonb)->>'id')::bigint;
 mto:=(put__ensure_crypto_asset('SMRG','Merge coin','ton','0:shared-merge',9::smallint,'{}'::jsonb)->>'id')::bigint;
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1000,mfrom,10);
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',2000,mfrom,10);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object(
  'bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',mfrom,'amount','10'));
 xm:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 PERFORM put__journal_bank_operation(uid,bank,'bank_asset_merge',jsonb_build_object('bank_account_id',bank,
  'from_crypto_asset_id',mfrom,'to_crypto_asset_id',mto,'operated_at',current_date));
 BEGIN PERFORM put__delete_crypto_source(uid,xm,gen_random_uuid()); RAISE EXCEPTION 'later merge ignored';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Сначала отмените более поздние операции%bank_asset_merge%','merge named: '||err;
END $$;
ROLLBACK;
