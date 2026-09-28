CREATE OR REPLACE FUNCTION budgeting.set__account_statistics(
    _user_id bigint, _account_id bigint, _included boolean
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE a budgeting.bank_accounts%ROWTYPE;
BEGIN
    SELECT * INTO a FROM budgeting.bank_accounts WHERE id=_account_id FOR UPDATE;
    IF NOT FOUND OR NOT budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
        RAISE EXCEPTION 'Счёт недоступен';
    END IF;
    IF a.account_kind <> 'investment' THEN
        RAISE EXCEPTION 'Настройка доступна для инвестиционных счетов';
    END IF;
    IF _included IS NULL THEN RAISE EXCEPTION 'Укажите участие в статистике'; END IF;
    UPDATE budgeting.bank_accounts SET include_in_statistics=_included WHERE id=_account_id;
    RETURN jsonb_build_object('bank_account_id',_account_id,'include_in_statistics',_included);
END
$function$;
