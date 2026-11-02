-- Own money returned from an overpaid credit card is already in the budget:
-- a card -> cash transfer adds to free budget only the part that takes the
-- card below zero. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
 uid bigint := 990000000980; me jsonb; bank bigint; free bigint; card bigint; cat bigint;
 op bigint; raised boolean;
BEGIN
 me := put__register_user_context(uid,'RUB',NULL,'Card','Overpay');
 bank := (me->>'bank_account_id')::bigint; free := (me->>'unallocated_category_id')::bigint;
 card := (put__create_credit_account(uid,'Card','credit_card','RUB',100000)->>'id')::bigint;
 cat := put__create_category(uid,'Food','regular');
 PERFORM put__record_income(uid,bank,100000,'RUB');

 -- 1. Return the whole overpayment: no budget change and no budget debt.
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',159);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'overpayment keeps free budget';
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',159);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'returned overpayment leaves free budget unchanged';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',1000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'returned overpayment leaves no budget debt';
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',1000);

 -- 2. One kopeck below zero is new money and new debt.
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',500);
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',500.01);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000.01,'kopeck below zero adds to free budget';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',0.01);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'kopeck repayment debits the debt';

 -- 3. More than the overpayment: only the part below zero, then repaid.
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',300);
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',1300);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=101000,'only the part below zero adds to free budget';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',1000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'repayment debits that part';

 -- 4. Overpayment left by a cancelled card expense.
 op := (put__record_expense(uid,card,cat,500,'RUB')->>'operation_id')::bigint;
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',500);
 PERFORM put__reverse_operation(uid,op);
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=card)=500,'cancelled expense leaves an overpayment';
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',500);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'returned refund leaves free budget unchanged';

 -- 5. An ordinary cash draw from a card at zero works as before.
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',2000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=102000,'cash draw adds to free budget';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',2000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'repaid draw debits free budget';

 -- 6. Cancelling either kind of transfer.
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',200);
 op := (put__transfer_between_accounts(uid,card,bank,'RUB',200)->>'operation_id')::bigint;
 PERFORM put__reverse_operation(uid,op);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'cancelled return keeps free budget';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=card)=200,'cancelled return restores the overpayment';
 op := (put__transfer_between_accounts(uid,card,bank,'RUB',1200)->>'operation_id')::bigint;
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=101000,'partial return adds the part below zero';
 PERFORM put__reverse_operation(uid,op);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'cancelled partial return debits that part';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',1000);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'cancelled partial return leaves no debt';
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',1200);
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=free)=100000,'card back to zero';

 -- 7. Credit accounts transfer only in the base currency, both ways.
 raised := false;
 BEGIN
  PERFORM put__transfer_between_accounts(uid,card,bank,'USD',10);
 EXCEPTION WHEN OTHERS THEN raised := SQLERRM LIKE '%базовой валюте%';
 END;
 ASSERT raised,'foreign currency transfer from a credit account is rejected';
 raised := false;
 BEGIN
  PERFORM put__transfer_between_accounts(uid,bank,card,'USD',10);
 EXCEPTION WHEN OTHERS THEN raised := SQLERRM LIKE '%базовой валюте%';
 END;
 ASSERT raised,'foreign currency transfer into a credit account is rejected';

 -- 8. Only a card at zero can be archived: an overpayment would be lost.
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',100);
 raised := false;
 BEGIN
  PERFORM set__archive_credit_account(uid,card);
 EXCEPTION WHEN OTHERS THEN raised := SQLERRM LIKE '%переплата%';
 END;
 ASSERT raised,'overpaid card is not archived';
 PERFORM put__transfer_between_accounts(uid,card,bank,'RUB',200);
 raised := false;
 BEGIN
  PERFORM set__archive_credit_account(uid,card);
 EXCEPTION WHEN OTHERS THEN raised := true;
 END;
 ASSERT raised,'card with debt is not archived';
 PERFORM put__transfer_between_accounts(uid,bank,card,'RUB',100);
 PERFORM set__archive_credit_account(uid,card);
 ASSERT NOT (SELECT is_active FROM bank_accounts WHERE id=card),'card at zero is archived';
END $$;
ROLLBACK;
