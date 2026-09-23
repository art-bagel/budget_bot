\set ON_ERROR_STOP on
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE u bigint; a bigint; b bigint; c bigint; p bigint; r jsonb; s jsonb;
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
RAISE NOTICE 'partial_transfer: %', s;
PERFORM put__transfer_crypto_to_investment(u,b,a,c,6,NULL,NULL,NULL,'2025-01-03');
RAISE NOTICE 'round_trip: %', get__crypto_position_entry_summary(p);
PERFORM put__transfer_crypto_from_investment(u,p,b,10,1500,NULL,'2025-01-04');
SELECT jsonb_build_object('status',status,'quantity',quantity) INTO s FROM portfolio_positions WHERE id=p;
RAISE NOTICE 'full_transfer: %',s;
RAISE NOTICE '18th_decimal_rounded: %',round(0.000000000000000001::numeric,12);
END $$;
ROLLBACK;
