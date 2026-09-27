-- Run on dev. All fixtures and changes are rolled back.
BEGIN;
DO $$
DECLARE uid bigint; aid bigint; result jsonb; blocked boolean;
BEGIN
    SELECT id INTO uid FROM budgeting.users ORDER BY id LIMIT 1;
    ASSERT uid IS NOT NULL, 'A dev user is required';
    INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type)
    VALUES ('user',uid,'archive-test-' || txid_current(),'investment','crypto') RETURNING id INTO aid;
    result := budgeting.set__crypto_account_settings(uid,aid,'Renamed-' || aid,'0x1234',true);
    ASSERT (result->>'is_archived')::boolean;
    ASSERT result->>'wallet_address'='0x1234';
    ASSERT result->>'name'='Renamed-' || aid;
    PERFORM budgeting.set__crypto_account_settings(uid,aid,'Renamed-' || aid,NULL,false);
    ASSERT (SELECT NOT is_archived AND wallet_address IS NULL FROM budgeting.bank_accounts WHERE id=aid);
    blocked := false;
    BEGIN
        PERFORM budgeting.set__crypto_account_settings(-1,aid,'Unauthorized',NULL,true);
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    ASSERT blocked, 'Another user cannot edit the account';
    blocked := false;
    BEGIN
        PERFORM budgeting.set__crypto_account_settings(uid,aid,' ',NULL,true);
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    ASSERT blocked, 'Empty names must be rejected';
    INSERT INTO budgeting.current_bank_balances(bank_account_id,currency_code,amount,historical_cost_in_base)
    VALUES(aid,'RUB',1,1);
    blocked := false;
    BEGIN
        PERFORM budgeting.set__crypto_account_settings(uid,aid,'Renamed-' || aid,NULL,true);
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    ASSERT blocked, 'A funded account cannot disappear into the archive';
END $$;
ROLLBACK;
