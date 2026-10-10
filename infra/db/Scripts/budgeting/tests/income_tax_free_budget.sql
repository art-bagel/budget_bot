-- Income tax checks the free budget the UI shows (Unallocated + FX Result),
-- not Unallocated alone: a crypto FX gain booked to FX Result leaves
-- Unallocated negative while the free budget is near zero.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE uid bigint:=990000000941; me jsonb; bank bigint; unalloc bigint; fx bigint; op bigint; r jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Tax','Free');
 bank:=(me->>'bank_account_id')::bigint;
 unalloc:=get__owner_system_category_id('user',uid,NULL,'Unallocated');
 fx:=get__owner_system_category_id('user',uid,NULL,'FX Result');
 PERFORM put__record_income(uid,bank,1000,'RUB');

 -- Move 1500 from Unallocated to FX Result: Unallocated -500, free +1000.
 INSERT INTO operations(actor_user_id,owner_type,owner_user_id,type) VALUES(uid,'user',uid,'allocate') RETURNING id INTO op;
 INSERT INTO budget_entries(operation_id,category_id,currency_code,amount) VALUES(op,unalloc,'RUB',-1500),(op,fx,'RUB',1500);
 PERFORM put__apply_current_budget_delta(unalloc,'RUB',-1500);
 PERFORM put__apply_current_budget_delta(fx,'RUB',1500);

 -- Unallocated after income is -400, below the 6 tax; free budget is 1094.
 r:=put__record_income(uid,bank,100,'RUB',NULL,NULL,NULL,NULL,6);
 ASSERT (r->>'tax_operation_id') IS NOT NULL,'tax recorded against the free budget';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=unalloc)=-406,'tax debits Unallocated';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=fx)=1500,'FX Result untouched';

 -- A free-budget deficit still rejects the tax.
 PERFORM put__apply_current_budget_delta(fx,'RUB',-2000);
 BEGIN
   PERFORM put__record_income(uid,bank,100,'RUB',NULL,NULL,NULL,NULL,6);
   RAISE EXCEPTION 'Deficit test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM='Сумма превышает остаток','free-budget deficit rejected';
 END;
END $$;
ROLLBACK;
