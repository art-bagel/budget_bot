-- Card repayment debits free budget only by the card's budget debt (cash drawn
-- from the card into Unallocated); cancelled transfers must not count towards
-- that debt. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
 uid bigint := 990000000970; me jsonb; bank bigint; free bigint; card bigint;
 repay bigint;
BEGIN
 me := put__register_user_context(uid,'RUB',NULL,'Card','Reversal');
 bank := (me->>'bank_account_id')::bigint; free := (me->>'unallocated_category_id')::bigint;
 card := (put__create_credit_account(uid,'Card','credit_card','RUB',100000)->>'id')::bigint;
 PERFORM put__record_income(uid,bank,100000,'RUB');
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',50000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=150000,'cash from card adds to free budget';

 -- 1. Overpay, cancel, repay the exact debt: free budget drops by the debt.
 repay := (put__transfer_between_accounts(uid,bank,card,'RUB',60000)->>'operation_id')::bigint;
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'overpayment debits only the debt';
 PERFORM put__reverse_operation(uid,repay);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=150000,'cancel restores free budget';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',50000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'repayment after cancel debits the debt';

 -- 2. A cancelled cash draw leaves no budget debt behind.
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',20000);
 PERFORM put__reverse_operation(uid,(SELECT max(id) FROM operations WHERE owner_user_id=uid AND type='account_transfer'));
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'cancelled draw restores free budget';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',1000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'no debt from a cancelled draw';
END $$;
ROLLBACK;
