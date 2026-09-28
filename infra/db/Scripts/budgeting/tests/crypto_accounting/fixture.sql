-- Isolated disposable PostgreSQL database only. No production credentials.
-- Real portfolio/asset/protocol schemas and calculation functions are loaded
-- by run_checks.py. Only surrounding identity/bank infrastructure is simplified.
CREATE SCHEMA budgeting;
CREATE TABLE budgeting.users(id bigint PRIMARY KEY);
CREATE TABLE budgeting.families(id bigint PRIMARY KEY);
CREATE TABLE budgeting.currencies(code char(3) PRIMARY KEY);
CREATE TABLE budgeting.bank_accounts(
 id bigint PRIMARY KEY, name text, owner_type text, owner_user_id bigint,
 owner_family_id bigint, account_kind text, investment_asset_type text,
 is_active boolean DEFAULT true);
CREATE TABLE budgeting.operations(
 id bigserial PRIMARY KEY, actor_user_id bigint, owner_type text,
 owner_user_id bigint, owner_family_id bigint, type text, comment text,
 operated_on date);
CREATE FUNCTION budgeting.has__owner_access(bigint,text,bigint,bigint)
 RETURNS boolean LANGUAGE sql AS $$SELECT $2='user' AND $1=$3$$;
CREATE FUNCTION budgeting.get__owner_base_currency(text,bigint,bigint)
 RETURNS char(3) LANGUAGE sql AS $$SELECT 'RUB'::char(3)$$;
CREATE FUNCTION budgeting.get__user_family_id(bigint)
 RETURNS bigint LANGUAGE sql AS $$SELECT NULL::bigint$$;
INSERT INTO budgeting.users VALUES(1);
INSERT INTO budgeting.currencies VALUES('RUB');
INSERT INTO budgeting.bank_accounts VALUES(1,'Isolated audit','user',1,NULL,'investment','crypto',true);
