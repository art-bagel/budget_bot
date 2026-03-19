-- Description:
--   Archives a credit account with zero balance (no remaining debt).
CREATE OR REPLACE FUNCTION budgeting.set__archive_credit_account(
    _user_id          bigint,
    _bank_account_id  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account_name     text;
    _owner_type       text;
    _owner_user_id    bigint;
    _owner_family_id  bigint;
    _account_kind     text;
    _balance          numeric(20, 8);
    _archive_suffix   text;
    _archived_name    text;
BEGIN
    SET search_path TO budgeting;

    SELECT name, owner_type, owner_user_id, owner_family_id, account_kind
    INTO _account_name, _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id AND is_active;

    IF _account_name IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Only credit accounts can be archived this way';
    END IF;

    -- Check that there is no remaining debt (sum of all currency balances in base terms)
    SELECT COALESCE(SUM(historical_cost_in_base), 0)
    INTO _balance
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id;

    IF _balance < 0 THEN
        RAISE EXCEPTION 'Cannot archive: credit account still has debt';
    END IF;

    _archive_suffix := ' [archived ' || _bank_account_id || ']';
    _archived_name  := left(_account_name, 100 - length(_archive_suffix)) || _archive_suffix;

    UPDATE bank_accounts
    SET is_active = false,
        name      = _archived_name
    WHERE id = _bank_account_id;

    RETURN jsonb_build_object(
        'bank_account_id', _bank_account_id,
        'name',            _account_name,
        'is_active',       false
    );
END
$function$;
