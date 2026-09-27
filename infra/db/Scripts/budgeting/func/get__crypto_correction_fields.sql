CREATE OR REPLACE FUNCTION budgeting.get__crypto_correction_fields(_kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
 SELECT CASE _kind
 WHEN 'lp_snapshot' THEN ARRAY['quantity','secondary_quantity']
 WHEN 'lp_withdraw' THEN ARRAY['quantity','secondary_quantity','share_percent']
 WHEN 'lp_reward' THEN ARRAY['quantity']
 WHEN 'swap' THEN ARRAY['from_amount','to_amount']
 WHEN 'transfer' THEN ARRAY['amount']
 WHEN 'fee' THEN ARRAY['quantity']
 WHEN 'create_protocol' THEN ARRAY['quantity','secondary_quantity']
 WHEN 'top_up_protocol' THEN ARRAY['quantity','secondary_quantity']
 WHEN 'close_protocol' THEN ARRAY['return_quantity','secondary_return_quantity']
 WHEN 'partial_close_protocol' THEN ARRAY['principal_qty','secondary_principal_qty','rewards_qty','secondary_rewards_qty']
 WHEN 'borrow' THEN ARRAY['debt_qty']
 WHEN 'repay' THEN ARRAY['repay_qty','interest_qty']
 WHEN 'accrue_interest' THEN ARRAY['quantity']
 WHEN 'liquidate' THEN ARRAY['collateral_qty','debt_qty','interest_qty','collateral_fee_qty']
 WHEN 'position_income' THEN ARRAY['quantity']
 WHEN 'protocol_yield' THEN ARRAY['quantity']
 WHEN 'bank_purchase' THEN ARRAY['quantity','fiat_amount']
 WHEN 'bank_buy' THEN ARRAY['quantity','fiat_amount']
 WHEN 'bank_cash_sell' THEN ARRAY['quantity','fiat_amount']
 WHEN 'bank_to_portfolio' THEN ARRAY['quantity']
 WHEN 'bank_withdraw' THEN ARRAY['quantity']
 ELSE ARRAY[]::text[] END
$f$;
