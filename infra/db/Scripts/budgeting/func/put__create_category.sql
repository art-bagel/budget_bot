-- Description:
--   Creates a user category for budget or income tracking.
-- Parameters:
--   _user_id bigint - Category owner.
--   _name text - Category name.
--   _kind text - Category kind: regular, group or income.
-- Returns:
--   bigint - Identifier of the created category.
CREATE OR REPLACE FUNCTION budgeting.put__create_category(
    _user_id bigint,
    _name text,
    _kind text
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_id bigint;
    _normalized_name text := btrim(_name);
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Category name cannot be empty';
    END IF;

    IF _kind NOT IN ('regular', 'group', 'income') THEN
        RAISE EXCEPTION 'Unsupported category kind: %', _kind;
    END IF;

    PERFORM 1
    FROM users
    WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    INSERT INTO categories (user_id, name, kind)
    VALUES (_user_id, _normalized_name, _kind)
    RETURNING id
    INTO _category_id;

    RETURN _category_id;
END
$function$;
