-- Regression for own transfers. Run only on an isolated dev database.
\set ON_ERROR_STOP on
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE u bigint; a bigint; b bigint; c bigint; p bigint; r jsonb; s jsonb; n bigint; rejected boolean;
BEGIN
INSERT INTO users(base_currency_code) VALUES ('RUB') RETURNING id INTO u;
INSERT INTO categories(owner_type,owner_user_id,name,kind) VALUES ('user',u,'Unallocated','system');
INSERT INTO bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',u,'Audit investment','investment','crypto') RETURNING id INTO a;
INSERT INTO bank_accounts(owner_type,owner_user_id,name) VALUES ('user',u,'Audit cash') RETURNING id INTO b;
INSERT INTO crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('ZZAUDIT','Audit boundary','testnet','boundary',18) RETURNING id INTO c;
r:=put__crypto_receive_reward(u,a,c,10,NULL,'2025-01-01'); p:=(r->>'position_id')::bigint;
-- Synthetic acquisition fixture; this is not an import of the owner's history.
UPDATE portfolio_events SET metadata=metadata||'{"entry_value_in_base":1000,"basis_quality":"known"}'::jsonb WHERE position_id=p;
r:=put__transfer_crypto_from_investment(u,p,b,6,900,NULL,'2025-01-02');
SELECT metadata INTO s FROM portfolio_events WHERE position_id=p ORDER BY id DESC LIMIT 1;
ASSERT (s->>'realized_in_base')::numeric = 0, 'own transfer must not realize a gain';
ASSERT (s->>'consumed_cost_basis')::numeric = 600, 'partial transfer carries average cost';
ASSERT (SELECT cost_base_remaining=600 FROM crypto_lots WHERE bank_account_id=b AND crypto_asset_id=c), 'bank lot inherits cost, not observation';
PERFORM put__transfer_crypto_to_investment(u,b,a,c,6,NULL,NULL,NULL,'2025-01-03');
s:=get__crypto_position_entry_summary(p);
ASSERT (s->>'remaining_cost_basis')::numeric=1000 AND (s->>'quantity_now')::numeric=10, 'round trip preserves quantity and basis';
PERFORM put__transfer_crypto_from_investment(u,p,b,10,1500,NULL,'2025-01-04');
SELECT jsonb_build_object('status',status,'quantity',quantity) INTO s FROM portfolio_positions WHERE id=p;
ASSERT s->>'status'='closed' AND (s->>'quantity')::numeric=0, 'full transfer leaves no position quantity';
ASSERT (SELECT sum(cost_base_remaining)=1000 FROM crypto_lots WHERE bank_account_id=b AND crypto_asset_id=c), 'full transfer conserves bank basis';
INSERT INTO crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('ZZDUST','Audit dust','testnet','dust',18) RETURNING id INTO c;
r:=put__crypto_receive_reward(u,a,c,0.000000000000000001,NULL,'2025-01-05'); p:=(r->>'position_id')::bigint;
PERFORM put__transfer_crypto_from_investment(u,p,b,0.000000000000000001);
ASSERT (SELECT amount=0.000000000000000001 AND cost_base_remaining=0 FROM current_crypto_balances WHERE bank_account_id=b AND crypto_asset_id=c), 'zero-cost EVM unit must not disappear';
r:=put__transfer_crypto_to_investment(u,b,a,c,0.000000000000000001,NULL,NULL,NULL,'2025-01-06'); p:=(r->>'position_id')::bigint;
s:=get__crypto_position_entry_summary(p);
ASSERT (s->>'remaining_cost_basis')::numeric=0 AND (s->>'quantity_now')::numeric=0.000000000000000001, 'zero-cost precision round trip';
ASSERT NOT EXISTS (SELECT 1 FROM current_crypto_balances WHERE bank_account_id=b AND crypto_asset_id=c), 'empty bank balance removed';
SELECT count(*) INTO n FROM operations;
rejected:=false;
BEGIN
 PERFORM put__transfer_crypto_from_investment(u,p,b,0.0000000000000000001);
EXCEPTION WHEN raise_exception THEN rejected:=true; END;
ASSERT rejected AND (SELECT count(*)=n FROM operations), 'overprecision rejected before posting';
rejected:=false;
BEGIN
 PERFORM put__transfer_crypto_from_investment(u+1,p,b,0.000000000000000001);
EXCEPTION WHEN raise_exception THEN rejected:=true; END;
ASSERT rejected AND (SELECT count(*)=n FROM operations), 'foreign actor rejected';
UPDATE portfolio_events SET metadata=metadata||'{"entry_value_in_base":null,"basis_quality":"unknown"}'::jsonb WHERE position_id=p;
rejected:=false;
BEGIN
 PERFORM put__transfer_crypto_from_investment(u,p,b,0.000000000000000001,100);
EXCEPTION WHEN raise_exception THEN rejected:=true; END;
ASSERT rejected AND (SELECT count(*)=n FROM operations), 'unknown cost cannot be replaced by supplied observation';
RAISE NOTICE 'bank_boundary: 12 assertions passed';
END $$;
ROLLBACK;
