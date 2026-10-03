BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE uid bigint:=990000000907; me jsonb; bank bigint; coll bigint; other_coll bigint; item jsonb; r jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Cost','Analytics');
 bank:=(me->>'bank_account_id')::bigint;
 coll:=(put__create_bank_account(uid,'Collection A','user','investment','collectible')->>'id')::bigint;
 other_coll:=(put__create_bank_account(uid,'Collection B','user','investment','collectible')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__transfer_between_accounts(uid,bank,coll,'RUB',5000);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_buy',
   jsonb_build_object('investment_account_id',coll,'title','Item','quantity',1,'amount_in_currency',1000,
   'currency_code','RUB','metadata','{"item_kind":"physical"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_fee',
   jsonb_build_object('position_id',item->'id','amount',100,'currency_code','RUB'),current_date);
 PERFORM put__transfer_between_accounts(uid,coll,other_coll,'RUB',500);
 r:=get__investment_cost_analytics(uid,'collectible');
 ASSERT (r->>'invested')::numeric=5000,'internal transfers are not contributions';
 ASSERT (r->>'cost')::numeric=4900,'items plus cash historical basis';
 ASSERT (r->>'fees')::numeric=100,'fee classification';
 ASSERT (r->>'other')::numeric=0,'bridge reconciles';
 r:=get__investment_cost_analytics(uid,'collectible',coll);
 ASSERT (r->>'withdrawn')::numeric=500,'account boundary counts transfer';
 ASSERT (r->>'cost')::numeric=4400,'account-scoped stock';
 r:=get__investment_cost_analytics(uid,'crypto');
 ASSERT (r->>'invested')::numeric=0 AND jsonb_array_length(r->'coins')=0,'types isolated';
 BEGIN
   PERFORM get__investment_cost_analytics(uid+1,'collectible',coll);
   RAISE EXCEPTION 'Access test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM='Account unavailable','other owner rejected';
 END;
END $$;
DO $$
DECLARE uid bigint:=990000000908; me jsonb; bank bigint; wallet bigint; other_wallet bigint; coin bigint; pos bigint; r jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Coin','Analytics');
 bank:=(me->>'bank_account_id')::bigint;
 wallet:=(put__create_bank_account(uid,'Wallet A','user','investment','crypto')->>'id')::bigint;
 other_wallet:=(put__create_bank_account(uid,'Wallet B','user','investment','crypto')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('ACOIN','Analytics coin','test','analytics-coin',9::smallint,'{}')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',10000,coin,100);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',
   jsonb_build_object('bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin,'amount','100'));
 SELECT id INTO pos FROM portfolio_positions WHERE investment_account_id=wallet AND status='open';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'transfer',
   jsonb_build_object('position_id',pos,'target_investment_account_id',other_wallet,'amount','20'));
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'create_protocol',
   jsonb_build_object('investment_account_id',wallet,'protocol_name','Stake','position_type','staking',
     'asset_symbol','ACOIN','crypto_asset_id',coin,'source_position_id',pos,'quantity','50'));
 r:=get__investment_cost_analytics(uid,'crypto');
 ASSERT (r->>'invested')::numeric=10000,'wallet and DeFi movements not new investments';
 ASSERT (r->>'cost')::numeric=10000 AND (r->>'other')::numeric=0,'coin bridge reconciles';
 ASSERT jsonb_array_length(r->'coins')=1,'wallets and DeFi aggregated once';
 ASSERT (r->'coins'->0->>'quantity')::numeric=100,'all quantities included';
 ASSERT (r->'coins'->0->>'unit_cost')::numeric=100,'weighted historical unit cost';
 ASSERT (r->'coins'->0->>'defi_quantity')::numeric=50,'DeFi quantity included';
 -- Regression: settled financing on disposed assets lives in event metadata,
 -- not in consumed_cost_basis; liquidation expenses are represented once here.
 INSERT INTO portfolio_events(position_id,event_type,event_at,quantity,metadata,created_by_user_id)
 VALUES(pos,'fee',current_date,0,'{"target_kind":"fee","consumed_cost_basis":2,"funding_confirmed_cost":3}',uid),
       (pos,'transfer_out',current_date,0,'{"source_kind":"liquidation_funding_settlement","consumed_cost_basis":0,"funding_interest_cost":7,"funding_confirmed_cost":11}',uid),
       (pos,'transfer_out',current_date,0,'{"target_kind":"bank","consumed_cost_basis":13,"funding_confirmed_cost":17}',uid),
       (pos,'transfer_out',current_date,0,'{"target_kind":"expense","consumed_cost_basis":19,"funding_confirmed_cost":23}',uid),
       (pos,'transfer_out',current_date,0,'{"target_kind":"lending_repay","consumed_cost_basis":100,"funding_interest_cost":5,"funding_confirmed_cost":2}',uid);
 r:=get__investment_cost_analytics(uid,'crypto');
 ASSERT (r->>'fees')::numeric=5,'fees include later confirmed funding';
 ASSERT (r->>'interest')::numeric=25,'interest includes settlement; principal is not expense';
 ASSERT (r->>'withdrawn')::numeric=30,'withdrawal cost includes later settlement';
 ASSERT (r->>'expenses')::numeric=42,'expenses include later confirmed funding';

END $$;
ROLLBACK;
