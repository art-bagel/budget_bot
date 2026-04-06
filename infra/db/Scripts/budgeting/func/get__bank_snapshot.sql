DROP FUNCTION IF EXISTS budgeting.get__bank_snapshot;
CREATE FUNCTION budgeting.get__bank_snapshot(
    _user_id bigint,
    _bank_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _base_currency_code char(3);
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'currency_code', cbb.currency_code,
                'amount', cbb.amount,
                'historical_cost_in_base', cbb.historical_cost_in_base,
                'base_currency_code', _base_currency_code
            )
            ORDER BY cbb.currency_code
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM current_bank_balances cbb
    WHERE cbb.bank_account_id = _bank_account_id
      AND cbb.amount <> 0;

    RETURN _result;
END
$function$;
