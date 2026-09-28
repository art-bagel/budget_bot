-- Reclassify a contract-less bank asset into its verified contract identity.
-- Historical lots keep their costs, IDs and FIFO timestamps. No sale or income.
CREATE OR REPLACE FUNCTION budgeting.put__merge_bank_crypto_asset(
 _uid bigint, _account bigint, _from bigint, _to bigint, _day date
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a record; src record; dst record; q numeric; cost numeric; op bigint; base char(3);
BEGIN
 SET search_path TO budgeting;
 IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Asset consolidation requires the source journal';
 END IF;
 SELECT * INTO a FROM bank_accounts WHERE id=_account FOR UPDATE;
 IF a.id IS NULL OR a.account_kind<>'cash' OR NOT has__owner_access(_uid,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
  RAISE EXCEPTION 'Нет доступа к банковскому счёту';
 END IF;
 SELECT * INTO src FROM crypto_assets WHERE id=_from;
 SELECT * INTO dst FROM crypto_assets WHERE id=_to;
 IF src.id IS NULL OR dst.id IS NULL OR _from=_to OR src.symbol<>dst.symbol
  OR src.network_code<>dst.network_code OR src.decimals<>dst.decimals
  OR src.contract_address<>'' OR dst.contract_address='' THEN
  RAISE EXCEPTION 'Выберите одну монету в одной сети: без контракта → с контрактом';
 END IF;
 PERFORM 1 FROM current_crypto_balances WHERE bank_account_id=_account AND crypto_asset_id IN (_from,_to) ORDER BY crypto_asset_id FOR UPDATE;
 PERFORM 1 FROM crypto_lots WHERE bank_account_id=_account AND crypto_asset_id=_from ORDER BY id FOR UPDATE;
 SELECT COALESCE(sum(amount_remaining),0),COALESCE(sum(cost_base_remaining),0) INTO q,cost
 FROM crypto_lots WHERE bank_account_id=_account AND crypto_asset_id=_from;
 IF q<=0 THEN RAISE EXCEPTION 'Нет остатка для объединения'; END IF;
 IF NOT EXISTS(SELECT 1 FROM current_crypto_balances WHERE bank_account_id=_account AND crypto_asset_id=_from AND amount=q AND cost_base_remaining=cost) THEN
  RAISE EXCEPTION 'Остаток не совпадает с лотами';
 END IF;
 IF _day IS NULL OR NOT isfinite(_day) THEN RAISE EXCEPTION 'Некорректная дата'; END IF;
 SELECT CASE WHEN a.owner_type='user' THEN (SELECT base_currency_code FROM users WHERE id=a.owner_user_id)
 ELSE (SELECT base_currency_code FROM families WHERE id=a.owner_family_id) END INTO base;
 INSERT INTO operations(actor_user_id,owner_type,owner_user_id,owner_family_id,type,comment,operated_on)
 VALUES(_uid,a.owner_type,a.owner_user_id,a.owner_family_id,'exchange','Объединение записей '||src.symbol,_day) RETURNING id INTO op;
 INSERT INTO crypto_bank_entries(operation_id,bank_account_id,crypto_asset_id,amount)
 VALUES(op,_account,_from,-q),(op,_account,_to,q);
 UPDATE crypto_lots SET crypto_asset_id=_to WHERE bank_account_id=_account AND crypto_asset_id=_from AND amount_remaining>0;
 PERFORM put__apply_current_crypto_delta(_account,_from,-q,-cost);
 PERFORM put__apply_current_crypto_delta(_account,_to,q,cost);
 RETURN jsonb_build_object('operation_id',op,'quantity',q::text,'cost_base',cost,'base_currency_code',base);
END $f$;
