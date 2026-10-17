-- What one shared balance row holds beyond the entries and lots it is derived
-- from: {amount, cost}, zeros when consistent. A cancel must not change it.
-- ponytail: repeats the formulas of rebuild_current_balances; merge them if
-- either changes.
DROP FUNCTION IF EXISTS budgeting.get__shared_balance_gap;
CREATE FUNCTION budgeting.get__shared_balance_gap(_table text, _key jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE acc bigint:=(_key->>'bank_account_id')::bigint; cur text:=_key->>'currency_code';
 asset bigint:=(_key->>'crypto_asset_id')::bigint; cat bigint:=(_key->>'category_id')::bigint;
 amount numeric; cost numeric;
BEGIN
 SET search_path TO budgeting;
 IF _table='current_crypto_balances' THEN
  SELECT COALESCE((SELECT b.amount FROM current_crypto_balances b WHERE b.bank_account_id=acc AND b.crypto_asset_id=asset),0)
    -COALESCE((SELECT sum(e.amount) FROM crypto_bank_entries e WHERE e.bank_account_id=acc AND e.crypto_asset_id=asset),0),
   COALESCE((SELECT b.cost_base_remaining FROM current_crypto_balances b WHERE b.bank_account_id=acc AND b.crypto_asset_id=asset),0)
    -COALESCE((SELECT sum(l.cost_base_remaining) FROM crypto_lots l WHERE l.bank_account_id=acc AND l.crypto_asset_id=asset
      AND l.amount_remaining>0),0)
  INTO amount,cost;
 ELSIF _table='current_bank_balances' THEN
  SELECT COALESCE(sum(e.amount),0) INTO amount FROM bank_entries e WHERE e.bank_account_id=acc AND e.currency_code=cur;
  SELECT CASE WHEN cur=get__owner_base_currency(a.owner_type,a.owner_user_id,a.owner_family_id) THEN round(amount,2)
    ELSE COALESCE((SELECT sum(l.cost_base_remaining) FROM fx_lots l WHERE l.bank_account_id=acc AND l.currency_code=cur
      AND l.amount_remaining>0),0) END
  INTO cost FROM bank_accounts a WHERE a.id=acc;
  SELECT COALESCE((SELECT b.amount FROM current_bank_balances b WHERE b.bank_account_id=acc AND b.currency_code=cur),0)-amount,
   COALESCE((SELECT b.historical_cost_in_base FROM current_bank_balances b WHERE b.bank_account_id=acc AND b.currency_code=cur),0)-cost
  INTO amount,cost;
 ELSE
  SELECT COALESCE((SELECT b.amount FROM current_budget_balances b WHERE b.category_id=cat AND b.currency_code=cur),0)
    -COALESCE((SELECT sum(e.amount) FROM budget_entries e WHERE e.category_id=cat AND e.currency_code=cur),0), 0
  INTO amount,cost;
 END IF;
 RETURN jsonb_build_object('amount',amount,'cost',cost);
END $f$;
