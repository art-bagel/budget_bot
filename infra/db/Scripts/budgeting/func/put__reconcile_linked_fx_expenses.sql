-- Rebuild FX expense allocation with explicit payment sources taking precedence
-- over FIFO. Quantities and bank postings are preserved; all changes are journaled.
CREATE OR REPLACE FUNCTION budgeting.put__reconcile_linked_fx_expenses(
 _uid bigint, _bank bigint, _currency char(3)
) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE a record; base char(3); e record; l record; r record; need numeric;
 take numeric; _cost numeric; old_cost numeric; new_cost numeric; old_bank_cost numeric;
BEGIN
 SET search_path TO budgeting;
 IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Expense funding repair requires journal capture';
 END IF;
 SELECT * INTO a FROM bank_accounts WHERE id=_bank FOR UPDATE;
 IF a.id IS NULL OR a.account_kind<>'cash' OR NOT has__owner_access(_uid,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
  RAISE EXCEPTION 'Access denied to expense account';
 END IF;
 base:=get__owner_base_currency(a.owner_type,a.owner_user_id,a.owner_family_id);
 IF _currency=base THEN RETURN; END IF;
 PERFORM 1 FROM current_bank_balances WHERE bank_account_id=_bank AND currency_code=_currency FOR UPDATE;
 SELECT historical_cost_in_base INTO old_bank_cost FROM current_bank_balances WHERE bank_account_id=_bank AND currency_code=_currency;
 CREATE TEMP TABLE IF NOT EXISTS linked_fx_expenses(op bigint PRIMARY KEY, qty numeric, category bigint, old_cost numeric, created_at timestamptz, lot bigint) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS linked_fx_pool(lot bigint PRIMARY KEY, qty numeric, cost numeric, created_at timestamptz) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS linked_fx_alloc(op bigint, lot bigint, qty numeric, cost numeric, PRIMARY KEY(op,lot)) ON COMMIT DROP;
 TRUNCATE pg_temp.linked_fx_expenses,pg_temp.linked_fx_pool,pg_temp.linked_fx_alloc;
 INSERT INTO pg_temp.linked_fx_expenses
 SELECT o.id,-b.amount,be.category_id,-be.amount,o.created_at,NULL
 FROM operations o JOIN bank_entries b ON b.operation_id=o.id
 JOIN budget_entries be ON be.operation_id=o.id
 WHERE o.type='expense' AND b.bank_account_id=_bank AND b.currency_code=_currency
 AND be.currency_code=base AND b.amount<0
 AND NOT EXISTS(SELECT 1 FROM operations rev WHERE rev.reversal_of_operation_id=o.id);
 -- Reject multi-posting/unsupported expenses rather than reallocating unrelated
 -- transfers, exchanges or another account's costs.
 FOR e IN SELECT * FROM pg_temp.linked_fx_expenses LOOP
  IF (SELECT count(*) FROM bank_entries WHERE operation_id=e.op)<>1
   OR (SELECT count(*) FROM budget_entries WHERE operation_id=e.op)<>1
   OR (SELECT COALESCE(sum(c.amount),0) FROM lot_consumptions c JOIN fx_lots f ON f.id=c.lot_id WHERE c.operation_id=e.op AND f.bank_account_id=_bank AND f.currency_code=_currency)<>e.qty
   OR (SELECT COALESCE(sum(cost_base),0) FROM lot_consumptions WHERE operation_id=e.op)<>e.old_cost THEN
   RAISE EXCEPTION 'Unsupported expense allocation %',e.op;
  END IF;
 END LOOP;
 FOR r IN SELECT ev.* FROM portfolio_events ev WHERE ev.metadata->>'action'='fiat_sell'
  AND ev.metadata->>'target_bank_account_id'=_bank::text AND ev.currency_code=_currency
  AND ev.metadata ? 'manual_expense_settlement' LOOP
  SELECT * INTO e FROM pg_temp.linked_fx_expenses WHERE op=(r.metadata#>>'{manual_expense_settlement,result,operation_id}')::bigint;
  IF e.op IS NULL THEN CONTINUE; END IF;
  IF e.qty<>r.amount OR r.metadata->>'fx_lot_id' IS NULL THEN RAISE EXCEPTION 'Linked payment does not match its expense'; END IF;
  IF e.lot IS NOT NULL THEN RAISE EXCEPTION 'Expense has multiple funding links'; END IF;
  UPDATE pg_temp.linked_fx_expenses SET lot=(r.metadata->>'fx_lot_id')::bigint WHERE op=e.op;
 END LOOP;
 PERFORM 1 FROM current_budget_balances WHERE category_id IN(SELECT category FROM pg_temp.linked_fx_expenses) AND currency_code=base ORDER BY category_id FOR UPDATE;
 PERFORM 1 FROM fx_lots WHERE bank_account_id=_bank AND currency_code=_currency ORDER BY id FOR UPDATE;
 INSERT INTO pg_temp.linked_fx_pool
 SELECT f.id,f.amount_remaining+COALESCE(c.qty,0),f.cost_base_remaining+COALESCE(c.cost,0),f.created_at
 FROM fx_lots f LEFT JOIN LATERAL (SELECT sum(lc.amount) qty,sum(lc.cost_base) cost FROM lot_consumptions lc
 JOIN pg_temp.linked_fx_expenses x ON x.op=lc.operation_id WHERE lc.lot_id=f.id) c ON true
 WHERE f.bank_account_id=_bank AND f.currency_code=_currency;
 -- Reserve each known payment's own lot first. Other expenses use FIFO from
 -- what remains; non-expense consumptions were never released into this pool.
 FOR e IN SELECT * FROM pg_temp.linked_fx_expenses ORDER BY (lot IS NULL),created_at,op LOOP
  need:=e.qty;
  FOR l IN SELECT * FROM pg_temp.linked_fx_pool WHERE qty>0
   AND (e.lot IS NULL OR lot=e.lot) AND created_at<=e.created_at ORDER BY created_at,lot LOOP
   EXIT WHEN need<=0;
   take:=LEAST(need,l.qty);
   _cost:=CASE WHEN take=l.qty THEN l.cost ELSE round(l.cost*take/l.qty,2) END;
   INSERT INTO pg_temp.linked_fx_alloc VALUES(e.op,l.lot,take,_cost);
   UPDATE pg_temp.linked_fx_pool p SET qty=p.qty-take,cost=p.cost-_cost WHERE p.lot=l.lot;
   need:=need-take;
  END LOOP;
  IF need<>0 THEN RAISE EXCEPTION 'Insufficient linked funding for expense %',e.op; END IF;
 END LOOP;
 -- Change only differing rows. This also makes repeating reconciliation a no-op.
 DELETE FROM lot_consumptions c USING pg_temp.linked_fx_expenses exp
 WHERE c.operation_id=exp.op AND NOT EXISTS(SELECT 1 FROM pg_temp.linked_fx_alloc n WHERE n.op=c.operation_id AND n.lot=c.lot_id);
 UPDATE lot_consumptions c SET amount=n.qty,cost_base=n.cost FROM pg_temp.linked_fx_alloc n
 WHERE c.operation_id=n.op AND c.lot_id=n.lot AND (c.amount,c.cost_base) IS DISTINCT FROM (n.qty,n.cost);
 INSERT INTO lot_consumptions(operation_id,lot_id,amount,cost_base)
 SELECT n.op,n.lot,n.qty,n.cost FROM pg_temp.linked_fx_alloc n
 WHERE NOT EXISTS(SELECT 1 FROM lot_consumptions c WHERE c.operation_id=n.op AND c.lot_id=n.lot);
 FOR e IN SELECT * FROM pg_temp.linked_fx_expenses LOOP
  SELECT sum(n.cost) INTO new_cost FROM pg_temp.linked_fx_alloc n WHERE n.op=e.op;
  old_cost:=e.old_cost;
  IF new_cost<>old_cost THEN
   UPDATE budget_entries SET amount=-new_cost WHERE operation_id=e.op AND category_id=e.category;
   PERFORM put__apply_current_budget_delta(e.category,base,old_cost-new_cost);
  END IF;
  UPDATE portfolio_events SET metadata=jsonb_set(metadata,'{manual_expense_settlement,result,expense_cost_in_base}',to_jsonb(new_cost))
  WHERE metadata#>>'{manual_expense_settlement,result,operation_id}'=e.op::text
  AND metadata#>'{manual_expense_settlement,result,expense_cost_in_base}' IS DISTINCT FROM to_jsonb(new_cost);
 END LOOP;
 UPDATE fx_lots f SET amount_remaining=p.qty,cost_base_remaining=p.cost FROM pg_temp.linked_fx_pool p
 WHERE f.id=p.lot AND (f.amount_remaining,f.cost_base_remaining) IS DISTINCT FROM (p.qty,p.cost);
 SELECT COALESCE(sum(cost),0) INTO new_cost FROM pg_temp.linked_fx_pool;
 IF new_cost<>COALESCE(old_bank_cost,0) THEN
  PERFORM put__apply_current_bank_delta(_bank,_currency,0,new_cost-COALESCE(old_bank_cost,0));
 END IF;
END $f$;
