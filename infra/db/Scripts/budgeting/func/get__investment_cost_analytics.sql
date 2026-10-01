-- Lifetime historical-cost bridge. Internal movements never count as new capital.
CREATE OR REPLACE FUNCTION budgeting.get__investment_cost_analytics(
 _user_id bigint, _asset_type text, _account_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE result jsonb; base_code text;
BEGIN
 IF _asset_type NOT IN ('crypto','collectible') THEN RAISE EXCEPTION 'Unsupported investment type'; END IF;
 IF _account_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM budgeting.bank_accounts a WHERE a.id=_account_id AND a.investment_asset_type=_asset_type
   AND budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)
 ) THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 SELECT base_currency_code INTO base_code FROM budgeting.users WHERE id=_user_id;
 WITH accounts AS (
   SELECT id FROM budgeting.bank_accounts a WHERE a.investment_asset_type=_asset_type AND a.is_active
     AND (_account_id IS NULL OR a.id=_account_id)
     AND budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)
 ), positions AS (
   SELECT p.* FROM budgeting.portfolio_positions p JOIN accounts a ON a.id=p.investment_account_id
 ), events AS (
   SELECT e.* FROM budgeting.portfolio_events e JOIN positions p ON p.id=e.position_id
 ), protocols AS (
   SELECT p.* FROM budgeting.crypto_protocol_positions p JOIN accounts a ON a.id=p.investment_account_id
   WHERE p.status='open'
 ), wallet AS (
   SELECT p.*,budgeting.get__crypto_position_entry_summary(p.id) summary
   FROM positions p WHERE p.asset_type_code='crypto' AND p.status='open' AND p.quantity>0
 ), coin_parts AS (
   SELECT (metadata->>'crypto_asset_id')::bigint asset_id,quantity,
     (summary->>'remaining_cost_basis')::numeric cost,
     COALESCE(summary->'funding_units','{}'::jsonb)<>'{}'::jsonb funded, false defi
   FROM wallet
   UNION ALL
   SELECT crypto_asset_id,COALESCE(current_quantity,quantity),
     CASE WHEN metadata->>'token1_crypto_asset_id' IS NULL THEN cost_basis_in_base
       WHEN metadata->>'token1_cost_basis_carried' IS NOT NULL
       THEN cost_basis_in_base-(metadata->>'token1_cost_basis_carried')::numeric END,
     COALESCE(metadata->'funding_units0','{}'::jsonb)<>'{}'::jsonb,true
   FROM protocols WHERE COALESCE(current_quantity,quantity)>0
   UNION ALL
   SELECT (metadata->>'token1_crypto_asset_id')::bigint,(metadata->>'token1_quantity')::numeric,
     (metadata->>'token1_cost_basis_carried')::numeric,
     COALESCE(metadata->'funding_units1','{}'::jsonb)<>'{}'::jsonb,true
   FROM protocols WHERE (metadata->>'token1_quantity')::numeric>0
 ), coins AS (
   SELECT asset_id,sum(quantity) quantity,sum(cost) cost,bool_or(cost IS NULL) incomplete,bool_or(funded) funded,
     sum(CASE WHEN defi THEN quantity ELSE 0 END) defi_quantity
   FROM coin_parts GROUP BY asset_id
 ), crypto_flows AS (
   SELECT
     COALESCE(sum((metadata->>'entry_value_in_base')::numeric) FILTER (
       WHERE metadata->>'source_kind' IN ('bank','collection')
       OR (event_type='transfer_in' AND NOT EXISTS (
         SELECT 1 FROM accounts a WHERE a.id=(metadata->>'source_investment_account_id')::bigint))),0) invested,
     COALESCE(sum(COALESCE((metadata->>'consumed_cost_basis')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER (
       WHERE metadata->>'target_kind' IN ('bank','collection')
       OR (metadata->>'target_kind'='cross_account' AND NOT EXISTS (
         SELECT 1 FROM accounts a WHERE a.id=(metadata->>'target_investment_account_id')::bigint))),0) withdrawn,
     COALESCE(sum(COALESCE((metadata->>'consumed_cost_basis')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER (WHERE metadata->>'target_kind'='bank'),0) bank_out,
     COALESCE(sum(COALESCE((metadata->>'consumed_cost_basis')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER (WHERE metadata->>'target_kind'='collection'),0) collection_out,
     COALESCE(sum(COALESCE((metadata->>'consumed_cost_basis')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER (WHERE event_type='fee'),0)
       -COALESCE(sum((metadata->>'entry_value_in_base')::numeric) FILTER (WHERE metadata->>'source_kind'='fee_refund'),0) fees,
     COALESCE(sum(COALESCE((metadata->>'funding_interest_cost')::numeric,0)
       +CASE WHEN metadata->>'target_kind'='lending_repay' OR metadata->>'source_kind'='liquidation_funding_settlement'
         THEN COALESCE((metadata->>'funding_confirmed_cost')::numeric,0) ELSE 0 END),0) interest,
     COALESCE(sum(COALESCE((metadata->>'consumed_cost_basis')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER (WHERE metadata->>'target_kind'='expense'),0) expenses
   FROM events WHERE _asset_type='crypto'
 ), cash_entries AS (
   SELECT e.operation_id,e.bank_account_id,e.amount,true crypto,e.crypto_asset_id::text currency
   FROM budgeting.crypto_bank_entries e JOIN accounts a ON a.id=e.bank_account_id WHERE _asset_type='collectible'
   UNION ALL
   SELECT e.operation_id,e.bank_account_id,e.amount,false,e.currency_code
   FROM budgeting.bank_entries e JOIN accounts a ON a.id=e.bank_account_id WHERE _asset_type='collectible'
 ), external_cash AS (
   SELECT e.* FROM cash_entries e
   WHERE NOT EXISTS (SELECT 1 FROM events pe WHERE pe.linked_operation_id=e.operation_id)
     -- Exclude internal transfers/exchanges inside the selected collection scope.
     AND NOT EXISTS (SELECT 1 FROM cash_entries other WHERE other.operation_id=e.operation_id AND other.amount*e.amount<0)
 ), collection_flows AS (
   SELECT
   COALESCE(sum(CASE WHEN amount>0 THEN CASE WHEN NOT crypto AND currency=base_code THEN amount WHEN crypto THEN (
     SELECT sum(cost_base_initial) FROM budgeting.crypto_lots l WHERE l.opened_by_operation_id=e.operation_id
       AND l.bank_account_id=e.bank_account_id AND l.crypto_asset_id::text=e.currency)
     ELSE (SELECT sum(cost_base_initial) FROM budgeting.fx_lots l WHERE l.opened_by_operation_id=e.operation_id
       AND l.bank_account_id=e.bank_account_id AND l.currency_code=e.currency) END ELSE 0 END),0) invested,
   COALESCE(sum(CASE WHEN amount<0 THEN CASE WHEN NOT crypto AND currency=base_code THEN -amount WHEN crypto THEN (
     SELECT sum(c.cost_base) FROM budgeting.crypto_lot_consumptions c JOIN budgeting.crypto_lots l ON l.id=c.lot_id
       WHERE c.operation_id=e.operation_id AND l.bank_account_id=e.bank_account_id AND l.crypto_asset_id::text=e.currency)
     ELSE (SELECT sum(c.cost_base) FROM budgeting.lot_consumptions c JOIN budgeting.fx_lots l ON l.id=c.lot_id
       WHERE c.operation_id=e.operation_id AND l.bank_account_id=e.bank_account_id AND l.currency_code=e.currency) END ELSE 0 END),0) withdrawn
   FROM external_cash e
 ), stock AS (
   SELECT CASE WHEN _asset_type='crypto' THEN
     COALESCE((SELECT sum((summary->>'remaining_cost_basis')::numeric) FROM wallet),0)
       +COALESCE((SELECT sum(cost_basis_in_base) FROM protocols),0)
     ELSE COALESCE((SELECT sum((metadata->>'amount_in_base')::numeric) FROM positions WHERE status='open'),0)
       +COALESCE((SELECT sum(cost_base_remaining) FROM budgeting.crypto_lots l JOIN accounts a ON a.id=l.bank_account_id),0)
       +COALESCE((SELECT sum(cost_base_remaining) FROM budgeting.fx_lots l JOIN accounts a ON a.id=l.bank_account_id WHERE l.currency_code<>base_code),0)
       +COALESCE((SELECT sum(amount) FROM budgeting.current_bank_balances b JOIN accounts a ON a.id=b.bank_account_id WHERE b.currency_code=base_code),0) END cost,
     CASE WHEN _asset_type='crypto' THEN COALESCE((SELECT bool_or(incomplete OR funded) FROM coins),false)
       OR EXISTS(SELECT 1 FROM protocols WHERE cost_basis_in_base IS NULL)
       ELSE EXISTS(SELECT 1 FROM positions WHERE status='open' AND metadata->>'acquisition_kind'='unknown') END incomplete
 ), totals AS (
   SELECT CASE WHEN _asset_type='crypto' THEN cf.invested ELSE cl.invested END invested,
     CASE WHEN _asset_type='crypto' THEN cf.withdrawn ELSE cl.withdrawn END withdrawn,
     s.cost,s.incomplete,cf.bank_out,cf.collection_out,
     CASE WHEN _asset_type='crypto' THEN cf.fees ELSE
       COALESCE((SELECT sum((metadata->>'fees_in_base')::numeric) FROM positions),0) END fees,
     cf.interest,
     cf.expenses
   FROM crypto_flows cf CROSS JOIN collection_flows cl CROSS JOIN stock s
 )
 SELECT jsonb_build_object('invested',invested,'withdrawn',withdrawn,'cost',cost,'incomplete',incomplete,
   'bank_out',bank_out,'collection_out',collection_out,'fees',fees,'interest',interest,'expenses',expenses,
   'other',invested-withdrawn-cost-fees-interest-expenses,
   'coins',COALESCE((SELECT jsonb_agg(jsonb_build_object('asset_id',c.asset_id,'symbol',a.symbol,
      'network',a.network_code,'quantity',c.quantity,'cost',COALESCE(c.cost,0),
      'unit_cost',CASE WHEN NOT c.incomplete AND c.quantity>0 THEN c.cost/c.quantity END,
      'incomplete',c.incomplete,'funded',c.funded,'defi_quantity',c.defi_quantity) ORDER BY c.cost DESC NULLS LAST)
     FROM coins c JOIN budgeting.crypto_assets a ON a.id=c.asset_id),'[]'::jsonb))
 INTO result FROM totals;
 RETURN result;
END $f$;
