-- Income on a coin whose balance went to zero (its position is closed) reopens
-- the coin on the same account instead of being rejected.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE uid bigint:=990000000931; me jsonb; bank bigint; wallet bigint; other_wallet bigint; coin bigint;
  pos bigint; reopened bigint; req uuid:=gen_random_uuid(); r jsonb; payload jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Zero','Coin');
 bank:=(me->>'bank_account_id')::bigint;
 wallet:=(put__create_bank_account(uid,'Wallet A','user','investment','crypto')->>'id')::bigint;
 other_wallet:=(put__create_bank_account(uid,'Wallet B','user','investment','crypto')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('ZCOIN','Zero coin','test','zero-coin',9::smallint,'{}')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,1000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1000,coin,10);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',
   jsonb_build_object('bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin,'amount','10'));
 SELECT id INTO pos FROM portfolio_positions WHERE investment_account_id=wallet AND status='open';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'transfer',
   jsonb_build_object('position_id',pos,'target_investment_account_id',other_wallet,'amount','10'));
 ASSERT (SELECT status FROM portfolio_positions WHERE id=pos)='closed','moving the whole balance closes the position';

 payload:=jsonb_build_object('position_id',pos,'amount',0,'currency_code','RUB','quantity','2.5',
   'income_kind','airdrop','destination','position');
 r:=put__manual_crypto_movement(uid,req,'position_income',payload);
 SELECT id INTO reopened FROM portfolio_positions WHERE investment_account_id=wallet AND status='open';
 ASSERT reopened IS NOT NULL AND reopened<>pos,'income opens a new position for the coin';
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=reopened)=2.5,'received units are held';
 ASSERT (SELECT amount_in_currency FROM portfolio_positions WHERE id=reopened)=0,'income adds no cost';
 ASSERT (SELECT metadata->>'crypto_asset_id' FROM portfolio_positions WHERE id=reopened)=coin::text,'same coin';
 ASSERT (SELECT status FROM portfolio_positions WHERE id=pos)='closed','closed history is untouched';
 ASSERT EXISTS(SELECT 1 FROM portfolio_events WHERE position_id=reopened AND event_type='income'),'income event on the open position';
 ASSERT EXISTS(SELECT 1 FROM operations WHERE id=(r->>'operation_id')::bigint AND type='investment_income'),'income operation recorded';

 PERFORM put__manual_crypto_movement(uid,req,'position_income',payload);
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=reopened)=2.5,'a repeated request is not applied twice';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'position_income',payload);
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=reopened)=5,'a second receipt joins the open position';
 ASSERT (SELECT count(*) FROM portfolio_positions WHERE investment_account_id=wallet AND status='open')=1,'one open position per coin';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'position_income',payload,NULL,
   jsonb_build_object('source_position_id',reopened,'quantity','0.5'));
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=reopened)=7,'income with a fee nets the fee out of the wallet';
 BEGIN
   PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'position_income',payload,NULL,
     jsonb_build_object('source_position_id',reopened,'quantity','100'));
   RAISE EXCEPTION 'Fee overspend test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM='Сумма превышает остаток','fee above the balance rejects the whole income';
 END;
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=reopened)=7,'rejected income leaves the wallet unchanged';

 BEGIN
   PERFORM put__manual_crypto_movement(uid+1,gen_random_uuid(),'position_income',payload);
   RAISE EXCEPTION 'Access test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM<>'Access test failed','other owner rejected';
 END;
END $$;
ROLLBACK;
