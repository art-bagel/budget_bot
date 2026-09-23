-- Run against an isolated dev database after installing the current functions.
-- All fixtures are rolled back.
BEGIN;
DO $test$
DECLARE
    u bigint; other_user bigint; account_id bigint; asset_id bigint; p bigint; a bigint; b bigint;
    h jsonb; h2 jsonb; denied boolean := false;
BEGIN
    INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id INTO u;
    INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id INTO other_user;
    INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type)
    VALUES('user',u,'History test','investment','crypto') RETURNING id INTO account_id;
    INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals)
    VALUES('TEST','History test','testnet',u::text,9) RETURNING id INTO asset_id;
    INSERT INTO budgeting.portfolio_positions(owner_type,owner_user_id,investment_account_id,
        asset_type_code,title,quantity,amount_in_currency,currency_code,created_by_user_id,metadata)
    VALUES('user',u,account_id,'crypto','TEST',10,100,'RUB',u,jsonb_build_object('asset_symbol','TEST','crypto_asset_id',asset_id,'network_code','testnet')) RETURNING id INTO p;
    INSERT INTO budgeting.portfolio_events(position_id,event_type,quantity,created_by_user_id,metadata)
    VALUES(p,'open',10,u,'{"entry_value_in_base":100,"basis_quality":"known"}');
    a := (budgeting.put__create_crypto_protocol_position(u,account_id,'Same protocol','staking','TEST',
        _quantity=>1,_source_position_id=>p)->>'id')::bigint;
    b := (budgeting.put__create_crypto_protocol_position(u,account_id,'Same protocol','staking','TEST',
        _quantity=>2,_source_position_id=>p)->>'id')::bigint;
    h := budgeting.get__crypto_protocol_history(u,a);
    h2 := budgeting.get__crypto_protocol_history(u,b);
    ASSERT (h->>'total')::int=1 AND (h2->>'total')::int=1, 'Same-day positions must not mix';
    ASSERT (h->'entries'->0->>'quantity')::numeric=1, 'Original deposit quantity';
    ASSERT (h2->'entries'->0->>'cost_basis')::numeric=20, 'Original deposit basis';
    ASSERT h->'entries'->0->>'kind'='stake_to_protocol', 'Exact opening link';
    PERFORM budgeting.put__top_up_crypto_protocol_position(u,a,p,1);
    h := budgeting.get__crypto_protocol_history(u,a,1,0);
    h2 := budgeting.get__crypto_protocol_history(u,a,1,1);
    ASSERT (h->>'total')::int=2 AND jsonb_array_length(h->'entries')=1, 'Pagination total';
    ASSERT h->'entries'->0->>'id'<>h2->'entries'->0->>'id', 'Pages must not repeat';
    ASSERT h->'entries'->0->>'kind'='top_up_protocol', 'Newest first';
    BEGIN
        PERFORM budgeting.get__crypto_protocol_history(other_user,a);
    EXCEPTION WHEN raise_exception THEN denied := true;
    END;
    ASSERT denied, 'Cross-owner access must fail';
    RAISE NOTICE 'PASS: exact opening links, cost, separate positions, top-up, pagination, owner access';
END
$test$;
ROLLBACK;
