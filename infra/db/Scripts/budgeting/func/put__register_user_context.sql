-- Description:
--   Registers a user in the budgeting model, creates the personal primary bank account
--   and the required personal system categories.
CREATE OR REPLACE FUNCTION budgeting.put__register_user_context(
    _user_id bigint,
    _base_currency_code char(3),
    _username text DEFAULT NULL,
    _first_name text DEFAULT NULL,
    _last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing_base_currency_code char(3);
    _bank_account_id bigint;
    _unallocated_category_id bigint;
    _fx_result_category_id bigint;
    _status text := 'created';
BEGIN
    SET search_path TO budgeting;

    PERFORM 1
    FROM currencies
    WHERE code = _base_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown base currency: %', _base_currency_code;
    END IF;

    SELECT base_currency_code
    INTO _existing_base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _existing_base_currency_code IS NULL THEN
        INSERT INTO users (id, base_currency_code, username, first_name, last_name)
        VALUES (_user_id, _base_currency_code, _username, _first_name, _last_name);
    ELSE
        _status := 'exists';

        IF _existing_base_currency_code <> _base_currency_code THEN
            RAISE EXCEPTION 'Base currency cannot be changed for user %', _user_id;
        END IF;

        UPDATE users
        SET username = COALESCE(_username, username),
            first_name = COALESCE(_first_name, first_name),
            last_name = COALESCE(_last_name, last_name)
        WHERE id = _user_id;
    END IF;

    SELECT id
    INTO _bank_account_id
    FROM bank_accounts
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id
      AND name = 'Main'
    LIMIT 1;

    IF _bank_account_id IS NULL THEN
        INSERT INTO bank_accounts (owner_type, owner_user_id, name, account_kind, is_primary, is_active)
        VALUES ('user', _user_id, 'Main', 'cash', true, true)
        RETURNING id
        INTO _bank_account_id;
    ELSE
        UPDATE bank_accounts
        SET is_primary = true,
            account_kind = 'cash',
            is_active = true
        WHERE id = _bank_account_id;
    END IF;

    SELECT id
    INTO _unallocated_category_id
    FROM categories
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id
      AND name = 'Unallocated'
    LIMIT 1;

    IF _unallocated_category_id IS NULL THEN
        INSERT INTO categories (owner_type, owner_user_id, name, kind, is_active)
        VALUES ('user', _user_id, 'Unallocated', 'system', true)
        RETURNING id
        INTO _unallocated_category_id;
    ELSE
        UPDATE categories
        SET is_active = true
        WHERE id = _unallocated_category_id;
    END IF;

    SELECT id
    INTO _fx_result_category_id
    FROM categories
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id
      AND name = 'FX Result'
    LIMIT 1;

    IF _fx_result_category_id IS NULL THEN
        INSERT INTO categories (owner_type, owner_user_id, name, kind, is_active)
        VALUES ('user', _user_id, 'FX Result', 'system', true)
        RETURNING id
        INTO _fx_result_category_id;
    ELSE
        UPDATE categories
        SET is_active = true
        WHERE id = _fx_result_category_id;
    END IF;

    RETURN jsonb_build_object(
        'status', _status,
        'user_id', _user_id,
        'bank_account_id', _bank_account_id,
        'unallocated_category_id', _unallocated_category_id,
        'fx_result_category_id', _fx_result_category_id,
        'base_currency_code', _base_currency_code,
        'hints_enabled', (SELECT hints_enabled FROM users WHERE id = _user_id)
    );
END
$function$;
