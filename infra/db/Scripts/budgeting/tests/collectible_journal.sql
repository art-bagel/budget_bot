-- End-to-end collection money and item tests; no fixtures survive.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE uid bigint:=990000000903; me jsonb; bank bigint; coll bigint; coin bigint; item jsonb; r jsonb;
 request uuid; payload jsonb; budget_before numeric; sid bigint; preview jsonb; err text; before_qty numeric;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Collection','Journal');
 bank:=(me->>'bank_account_id')::bigint;
 coll:=(put__create_bank_account(uid,'Collection','user','investment','collectible')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('COLL','Test','test','collectible-journal',9::smallint,'{}')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1000,coin,100);
 SELECT amount INTO budget_before FROM current_budget_balances WHERE category_id=(me->>'unallocated_category_id')::bigint;
 payload:=jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin,'amount','100');
 request:=gen_random_uuid();
 r:=put__manual_collectible_movement(uid,request,'collectible_transfer',payload,current_date);
 ASSERT put__manual_collectible_movement(uid,request,'collectible_transfer',payload,current_date)=r,'transfer retry';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=(me->>'unallocated_category_id')::bigint)=budget_before-1000,'bank to collection budget';
 payload:=jsonb_build_object('investment_account_id',coll,'crypto_asset_id',coin,'crypto_quantity','40','title','Four NFTs','quantity','4','metadata','{"item_kind":"nft"}'::jsonb);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',payload,current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 payload:=jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','10');
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_topup',payload,current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_fee',payload||'{"crypto_quantity":"1"}',current_date);
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',payload||'{"crypto_quantity":"30","item_quantity":"2"}',current_date);
 ASSERT r->>'status'='open' AND (r->>'quantity')::numeric=2,'partial sale keeps two';
 ASSERT (r->'metadata'->>'amount_in_base')::numeric=250,'half cost remains';
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',payload||'{"crypto_quantity":"30"}',current_date);
 ASSERT r->>'status'='closed','full sale closes';
 ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=109,'coins 100-40-10-1+60';
 ASSERT (SELECT cost_base_remaining FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=990,'only fee consumed cost';
 request:=gen_random_uuid();
 preview:=put__correct_crypto_source(uid,sid,1,request,'[{"command_index":0,"field":"crypto_quantity","value":"42"}]','Purchase correction',false,NULL);
 PERFORM put__correct_crypto_source(uid,sid,1,request,'[{"command_index":0,"field":"crypto_quantity","value":"42"}]','Purchase correction',true,preview->>'preview_token');
 ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=107,'purchase correction propagates';
 ASSERT (SELECT cost_base_remaining FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=990,'correction preserves cost';
 payload:=jsonb_build_object('investment_account_id',coll,'title','Free NFT','quantity','1','metadata','{"item_kind":"nft"}'::jsonb);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',payload,current_date);
 ASSERT (item->'metadata'->>'amount_in_base')::numeric=0,'free receipt cost zero';
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','5'),current_date);
 ASSERT (SELECT cost_base_remaining FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=990,'free sale carries zero';
 SELECT amount INTO before_qty FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin;
 err:='';
 BEGIN
  PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',payload||jsonb_build_object('crypto_asset_id',coin,'crypto_quantity','100000'),current_date);
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err<>'' AND (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=before_qty,'overspend atomic';
 payload:=jsonb_build_object('from_account_id',coll,'to_account_id',bank,'crypto_asset_id',coin,'amount',before_qty::text);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',payload,current_date);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=(me->>'unallocated_category_id')::bigint)=budget_before-10,'return excludes fee';
 ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin),0)=0,'collection empty';
END $$;
DO $$
DECLARE uid bigint:=990000000904; me jsonb; bank bigint; coll bigint; item jsonb; r jsonb; payload jsonb; req uuid:=gen_random_uuid(); sid bigint; preview jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Fiat','Journal');
 bank:=(me->>'bank_account_id')::bigint;
 coll:=(put__create_bank_account(uid,'Collection','user','investment','collectible')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,20000,'RUB');
 PERFORM put__transfer_between_accounts(uid,bank,coll,'RUB',10000);
 payload:=jsonb_build_object('investment_account_id',coll,'title','Physical items','quantity',4,'amount_in_currency',4000,'currency_code','RUB','metadata','{"item_kind":"physical"}'::jsonb);
 item:=put__manual_collectible_movement(uid,req,'collectible_fiat_buy',payload,current_date);
 ASSERT put__manual_collectible_movement(uid,req,'collectible_fiat_buy',payload,current_date)=item,'fiat buy retry';
 sid:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 payload:=jsonb_build_object('position_id',item->'id','amount_in_currency',1000,'currency_code','RUB');
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_topup',payload,current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_fee',payload||'{"amount":100}',current_date);
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_partial',jsonb_build_object('position_id',item->'id','return_amount_in_currency',3000,'return_currency_code','RUB','principal_reduction_in_currency',2500,'closed_quantity',2),current_date);
 ASSERT (r->>'quantity')::numeric=2 AND (r->'metadata'->>'amount_in_base')::numeric=2500,'fiat partial';
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',jsonb_build_object('position_id',item->'id','close_amount_in_currency',3000,'close_currency_code','RUB'),current_date);
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB')=10900,'fiat balance';
 req:=gen_random_uuid();
 preview:=put__correct_crypto_source(uid,sid,1,req,'[{"command_index":0,"field":"amount_in_currency","value":"4200"}]','Fiat correction',false,NULL);
 PERFORM put__correct_crypto_source(uid,sid,1,req,'[{"command_index":0,"field":"amount_in_currency","value":"4200"}]','Fiat correction',true,preview->>'preview_token');
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB')=10700,'fiat correction replay';
END $$;
DO $$
DECLARE uid bigint:=990000000905; me jsonb; bank bigint; coll bigint; item jsonb; cost numeric;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'USD','Journal');
 bank:=(me->>'bank_account_id')::bigint;
 coll:=(put__create_bank_account(uid,'Collection','user','investment','collectible')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__exchange_currency(uid,bank,'RUB',10000,'USD',100);
 PERFORM put__transfer_between_accounts(uid,bank,coll,'USD',100);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_buy',jsonb_build_object('investment_account_id',coll,'title','USD item','quantity',1,'amount_in_currency',40,'currency_code','USD','metadata','{"item_kind":"nft"}'::jsonb),current_date);
 ASSERT (item->'metadata'->>'amount_in_base')::numeric=4000,'USD purchase carries RUB cost';
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_fee',jsonb_build_object('position_id',item->'id','amount',1,'currency_code','USD'),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_close',jsonb_build_object('position_id',item->'id','close_amount_in_currency',50,'close_currency_code','USD','close_amount_in_base',5000),current_date);
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='USD')=109,'USD sale balance';
END $$;
DO $$
DECLARE uid bigint:=990000000906; me jsonb; bank bigint; coll bigint; other_coll bigint;
 item jsonb; history jsonb; sid bigint;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'History','Filter');
 bank:=(me->>'bank_account_id')::bigint;
 coll:=(put__create_bank_account(uid,'First collection','user','investment','collectible')->>'id')::bigint;
 other_coll:=(put__create_bank_account(uid,'Second collection','user','investment','collectible')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__transfer_between_accounts(uid,bank,coll,'RUB',5000);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_buy',
   jsonb_build_object('investment_account_id',coll,'title','History item','quantity',1,
     'amount_in_currency',1000,'currency_code','RUB','metadata','{"item_kind":"physical"}'::jsonb),current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 -- More than a page of descriptive events must not hide the purchase.
 FOR i IN 1..35 LOOP
   PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',
     jsonb_build_object('investment_account_id',coll,'title','Free item','quantity',1,
       'metadata','{"item_kind":"physical"}'::jsonb),current_date);
 END LOOP;
 history:=get__crypto_correction_history(uid,coll);
 ASSERT jsonb_array_length(history)=1,'only editable events before pagination';
 ASSERT (history->0->>'id')::bigint=sid,'purchase still on first page';
 ASSERT history->0->>'context'='History item','collection item title available';
 ASSERT get__crypto_correction_history(uid,other_coll)='[]'::jsonb,'selected collection isolated';
END $$;
ROLLBACK;
