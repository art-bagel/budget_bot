DROP FUNCTION IF EXISTS budgeting.put__create_family;
CREATE FUNCTION budgeting.put__create_family(
    _user_id bigint,
    _name text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _default_name text := 'Моя семья';
    _family_id bigint;
    _base_currency_code char(3);
    _bank_account_id bigint;
    _unallocated_category_id bigint;
    _fx_result_category_id bigint;
    _normalized_name text := COALESCE(NULLIF(btrim(_name), ''), _default_name);
BEGIN
    SET search_path TO budgeting;

    IF budgeting.get__user_family_id(_user_id) IS NOT NULL THEN
        RAISE EXCEPTION 'User % already belongs to a family', _user_id;
    END IF;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    INSERT INTO families (name, base_currency_code, created_by_user_id)
    VALUES (_normalized_name, _base_currency_code, _user_id)
    RETURNING id
    INTO _family_id;

    INSERT INTO family_members (family_id, user_id, role)
    VALUES (_family_id, _user_id, 'owner');

    INSERT INTO bank_accounts (owner_type, owner_family_id, name, account_kind, is_primary, is_active)
    VALUES ('family', _family_id, 'Family Main', 'cash', true, true)
    RETURNING id
    INTO _bank_account_id;

    INSERT INTO categories (owner_type, owner_family_id, name, kind, is_active)
    VALUES ('family', _family_id, 'Unallocated', 'system', true)
    RETURNING id
    INTO _unallocated_category_id;

    INSERT INTO categories (owner_type, owner_family_id, name, kind, is_active)
    VALUES ('family', _family_id, 'FX Result', 'system', true)
    RETURNING id
    INTO _fx_result_category_id;

    RETURN jsonb_build_object(
        'family_id', _family_id,
        'name', _normalized_name,
        'base_currency_code', _base_currency_code,
        'bank_account_id', _bank_account_id,
        'unallocated_category_id', _unallocated_category_id,
        'fx_result_category_id', _fx_result_category_id
    );
END
$function$;
