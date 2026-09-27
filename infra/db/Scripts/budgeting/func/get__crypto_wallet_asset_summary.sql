CREATE OR REPLACE FUNCTION budgeting.get__crypto_wallet_asset_summary(_account_id bigint, _asset_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $function$
WITH parts AS (
    SELECT p.quantity, budgeting.get__crypto_position_entry_summary(p.id) s
    FROM budgeting.portfolio_positions p
    WHERE p.investment_account_id=_account_id AND p.asset_type_code='crypto'
        AND p.metadata->>'crypto_asset_id'=_asset_id::text AND p.status='open'
), totals AS (
    SELECT COALESCE(sum(quantity),0) quantity,
        COALESCE(sum((s->>'remaining_cost_basis')::numeric),0) cost,
        COALESCE(sum((s->>'total_entry_value_in_base')::numeric),0) entry,
        COALESCE(sum((s->>'total_consumed_cost_basis')::numeric),0) consumed,
        CASE WHEN bool_or(s->>'basis_quality'='invalid') THEN 'invalid'
             WHEN bool_or(s->>'basis_quality'='unknown') THEN 'unknown'
             WHEN bool_or(s->>'basis_quality'='estimated') THEN 'estimated'
             WHEN COALESCE(sum((s->>'total_entry_value_in_base')::numeric),0)=0 THEN 'confirmed_zero'
             ELSE 'known' END quality
    FROM parts
), funding AS (
    SELECT key, sum(value::numeric) quantity FROM parts, jsonb_each_text(s->'funding_units') GROUP BY key
), units AS (
    SELECT COALESCE(jsonb_object_agg(key,quantity),'{}') units FROM funding WHERE quantity<>0
), components AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('loan_id',f.key,'quantity',f.quantity::text,
        'symbol',COALESCE(a.symbol,p.metadata->>'borrowed_asset_symbol','?'))),'[]') items
    FROM funding f JOIN budgeting.crypto_protocol_positions p ON p.id=f.key::bigint
    LEFT JOIN budgeting.crypto_assets a ON a.id=(p.metadata->>'borrowed_crypto_asset_id')::bigint
    WHERE f.quantity<>0
)
SELECT jsonb_build_object('quantity_now',quantity,'basis_quality',quality,
    'remaining_cost_basis',CASE WHEN quality IN ('unknown','invalid') THEN NULL ELSE cost END,
    'avg_cost_per_unit',CASE WHEN quality IN ('unknown','invalid') THEN NULL WHEN quantity=0 THEN 0 ELSE cost/quantity END,
    'total_entry_value_in_base',CASE WHEN quality IN ('unknown','invalid') THEN NULL ELSE entry END,
    'total_consumed_cost_basis',CASE WHEN quality IN ('unknown','invalid') THEN NULL ELSE consumed END,
    'funding_units',units,'funding_components',items,'basis_final',units='{}'::jsonb)
FROM totals, units, components
$function$;
