CREATE OR REPLACE FUNCTION budgeting.get__crypto_correction_state(_anchor_account_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $f$
BEGIN
 RETURN (WITH owner AS (SELECT * FROM budgeting.bank_accounts WHERE id=_anchor_account_id),
 accounts AS (SELECT a.id FROM budgeting.bank_accounts a,owner o WHERE a.owner_type=o.owner_type
 AND a.owner_user_id IS NOT DISTINCT FROM o.owner_user_id AND a.owner_family_id IS NOT DISTINCT FROM o.owner_family_id)
 SELECT jsonb_build_object(
 'positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.title,'quantity',p.quantity::text,
 'cost',CASE WHEN p.asset_type_code='collectible' THEN p.metadata->'amount_in_base' ELSE budgeting.get__crypto_position_entry_summary(p.id)->'remaining_cost_basis' END,'funding',p.metadata->'funding_units') ORDER BY p.id)
 FROM budgeting.portfolio_positions p WHERE p.investment_account_id IN (SELECT id FROM accounts) AND p.asset_type_code IN ('crypto','collectible')),'[]'::jsonb),
 'protocols',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.protocol_name,'quantity',p.current_quantity::text,
 'cost',p.cost_basis_in_base::text,'metadata',p.metadata) ORDER BY p.id)
 FROM budgeting.crypto_protocol_positions p WHERE p.investment_account_id IN (SELECT id FROM accounts)),'[]'::jsonb),
 'bank',COALESCE((SELECT jsonb_agg(to_jsonb(b)-'updated_at' ORDER BY b.bank_account_id,b.currency_code)
 FROM budgeting.current_bank_balances b WHERE b.bank_account_id IN (SELECT id FROM accounts)),'[]'::jsonb),
 'budget',COALESCE((SELECT jsonb_agg(jsonb_build_object('category_id',b.category_id,'name',c.name,
 'currency_code',b.currency_code,'amount',b.amount::text) ORDER BY b.category_id,b.currency_code)
 FROM budgeting.current_budget_balances b JOIN budgeting.categories c ON c.id=b.category_id,owner o
 WHERE c.owner_type=o.owner_type AND c.owner_user_id IS NOT DISTINCT FROM o.owner_user_id
 AND c.owner_family_id IS NOT DISTINCT FROM o.owner_family_id),'[]'::jsonb),
 'crypto_bank',COALESCE((SELECT jsonb_agg((to_jsonb(b)-'updated_at')||jsonb_build_object('symbol',ca.symbol) ORDER BY b.bank_account_id,b.crypto_asset_id)
 FROM budgeting.current_crypto_balances b JOIN budgeting.crypto_assets ca ON ca.id=b.crypto_asset_id WHERE b.bank_account_id IN (SELECT id FROM accounts)),'[]'::jsonb)));
END
$f$;
