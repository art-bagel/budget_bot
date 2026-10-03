CREATE OR REPLACE FUNCTION budgeting.set__crypto_account_settings(
    _user_id bigint, _account_id bigint, _name text, _wallet_address text, _archived boolean
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE a budgeting.bank_accounts%ROWTYPE;
BEGIN
    SELECT * INTO a FROM budgeting.bank_accounts WHERE id=_account_id FOR UPDATE;
    IF NOT FOUND OR NOT budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
        RAISE EXCEPTION 'Счёт недоступен';
    END IF;
    IF a.account_kind <> 'investment' OR a.investment_asset_type NOT IN ('crypto','collectible') THEN
        RAISE EXCEPTION 'Настройка доступна для криптовалютных счетов и коллекций';
    END IF;
    IF nullif(trim(_name),'') IS NULL OR length(trim(_name)) > 100 THEN
        RAISE EXCEPTION 'Название должно содержать от 1 до 100 символов';
    END IF;
    IF length(trim(_wallet_address)) > 256 OR _archived IS NULL THEN
        RAISE EXCEPTION 'Некорректные параметры счёта';
    END IF;
    UPDATE budgeting.bank_accounts SET name=trim(_name),wallet_address=nullif(trim(_wallet_address),''),is_archived=_archived WHERE id=_account_id;
    RETURN jsonb_build_object('bank_account_id',_account_id,'name',trim(_name),'wallet_address',nullif(trim(_wallet_address),''),'is_archived',_archived);
END
$function$;
