-- Description:
--   Moves budget between two categories in the user's base currency.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _from_category_id bigint - Budget source category.
--   _to_category_id bigint - Budget destination category.
--   _amount_in_base numeric - Amount to move in the user's base currency.
--   _comment text - Optional comment.
-- Returns:
--   bigint - Identifier of the created operation.
CREATE OR REPLACE FUNCTION budgeting.put__allocate_budget(
    _user_id bigint,
    _from_category_id bigint,
    _to_category_id bigint,
    _amount_in_base numeric,
    _comment text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _from_kind text;
    _to_kind text;
    _to_name text;
    _from_balance numeric(20, 2);
    _operation_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _from_category_id = _to_category_id THEN
        RAISE EXCEPTION 'Budget source and destination categories must be different';
    END IF;

    IF _amount_in_base <= 0 THEN
        RAISE EXCEPTION 'Allocated amount must be positive';
    END IF;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    SELECT kind
    INTO _from_kind
    FROM categories
    WHERE id = _from_category_id
      AND user_id = _user_id
      AND is_active;

    IF _from_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active source category %', _from_category_id;
    END IF;

    IF _from_kind = 'group' THEN
        RAISE EXCEPTION 'Source category % cannot be of kind %', _from_category_id, _from_kind;
    END IF;

    SELECT kind, name
    INTO _to_kind, _to_name
    FROM categories
    WHERE id = _to_category_id
      AND user_id = _user_id
      AND is_active;

    IF _to_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active destination category %', _to_category_id;
    END IF;

    IF _to_kind = 'group' THEN
        RAISE EXCEPTION 'Destination category % cannot be of kind %', _to_category_id, _to_kind;
    END IF;

    IF _to_kind = 'system' AND _to_name <> 'Unallocated' THEN
        RAISE EXCEPTION 'Destination system category % is not supported', _to_category_id;
    END IF;

    SELECT COALESCE(sum(amount), 0)
    INTO _from_balance
    FROM budget_entries
    WHERE category_id = _from_category_id
      AND currency_code = _base_currency_code;

    IF _from_balance < round(_amount_in_base, 2) THEN
        RAISE EXCEPTION 'Insufficient budget in category %', _from_category_id;
    END IF;

    INSERT INTO operations (user_id, type, comment)
    VALUES (_user_id, 'allocate', _comment)
    RETURNING id
    INTO _operation_id;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES
        (_operation_id, _from_category_id, _base_currency_code, -round(_amount_in_base, 2)),
        (_operation_id, _to_category_id, _base_currency_code, round(_amount_in_base, 2));

    RETURN _operation_id;
END
$function$;
