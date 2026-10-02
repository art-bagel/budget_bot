-- Direct transfers keep investment money outside the bank budget.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
 uid bigint := 990000000940; me jsonb; bank bigint; deposit bigint; coll bigint;
 card bigint; loan bigint; free bigint; before_budget numeric; result jsonb; op bigint; err text;
BEGIN
 me := put__register_user_context(uid,'RUB',NULL,'Direct','Transfers');
 bank := (me->>'bank_account_id')::bigint; free := (me->>'unallocated_category_id')::bigint;
 deposit := (put__create_bank_account(uid,'Deposit','user','investment','deposit')->>'id')::bigint;
 coll := (put__create_bank_account(uid,'Items','user','investment','collectible')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,30000,'RUB');
 PERFORM put__transfer_between_accounts(uid,bank,deposit,'RUB',10000);
 card := (put__create_credit_account(uid,'Card','credit_card','RUB',5000)->>'id')::bigint;
 loan := (put__create_credit_account(uid,'Loan','loan','RUB',10000,bank,'user',36.5,NULL::smallint,current_date-10)->>'id')::bigint;
 before_budget := (SELECT amount FROM current_budget_balances WHERE category_id=free);

 -- Move liquid cash between investment accounts and draw / repay card funds.
 PERFORM put__transfer_between_accounts(uid,deposit,coll,'RUB',1000);
 PERFORM put__transfer_between_accounts(uid,card,deposit,'RUB',2000);
 PERFORM put__transfer_between_accounts(uid,deposit,card,'RUB',2000);
 ASSERT COALESCE((SELECT amount FROM current_bank_balances WHERE bank_account_id=card AND currency_code='RUB'),0)=0,'card repaid';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=deposit AND currency_code='RUB')=9000,'deposit free cash';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=before_budget,'no artificial bank budget movements';

 -- Term loan uses the repayment engine, including interest, instead of a raw transfer.
 result := put__repay_credit_account(uid,deposit,loan,'RUB',1100,NULL,CURRENT_TIMESTAMP,'early',false);
 op := (result->>'operation_id')::bigint;
 ASSERT (result->>'interest_paid')::numeric > 0,'interest is accounted for';
 ASSERT (result->>'principal_paid')::numeric + (result->>'interest_paid')::numeric=1100,'payment split';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=deposit AND currency_code='RUB')=7900,'investment pays full amount';
 ASSERT NOT EXISTS(SELECT 1 FROM budget_entries WHERE operation_id=op),'repayment does not spend budget twice';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=before_budget,'repayment leaves budget unchanged';
 PERFORM put__reverse_operation(uid,op);
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=deposit AND currency_code='RUB')=9000,'reversal restores investment cash';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=loan AND currency_code='RUB')=-10000,'reversal restores debt';
 ASSERT NOT EXISTS(SELECT 1 FROM credit_payment_events WHERE operation_id=op),'reversal removes payment event';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=before_budget,'reversal leaves budget unchanged';
 -- Overspending must fail without changing either side.
 err := '';
 BEGIN
  PERFORM put__repay_credit_account(uid,deposit,loan,'RUB',9500,NULL,CURRENT_TIMESTAMP,'early',false);
 EXCEPTION WHEN raise_exception THEN err := SQLERRM;
 END;
 ASSERT err='Сумма превышает остаток','investment balance checked';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=deposit AND currency_code='RUB')=9000,'failure atomic';

 -- The existing cash repayment still spends budget exactly once.
 result := put__repay_credit_account(uid,bank,loan,'RUB',1100,NULL,CURRENT_TIMESTAMP,'early',false);
 op := (result->>'operation_id')::bigint;
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=before_budget-1100,'cash repayment budget';
 PERFORM put__reverse_operation(uid,op);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=before_budget,'cash reversal budget';
END $$;
ROLLBACK;
