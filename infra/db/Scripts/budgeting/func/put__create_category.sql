-- Description:
--   Creates a user category for budget tracking.
-- Parameters:
--   _user_id bigint - Category owner.
--   _name text - Category name.
--   _kind text - Category kind: regular or group.
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
    _archived_category_id bigint;
    _archive_suffix text;
    _normalized_name text := btrim(_name);
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Category name cannot be empty';
    END IF;

    IF _kind NOT IN ('regular', 'group') THEN
        RAISE EXCEPTION 'Unsupported category kind: %', _kind;
    END IF;

    PERFORM 1
    FROM users
    WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    SELECT id
    INTO _archived_category_id
    FROM categories
    WHERE user_id = _user_id
      AND name = _normalized_name
      AND NOT is_active
    LIMIT 1;

    IF _archived_category_id IS NOT NULL THEN
        _archive_suffix := ' [archived ' || _archived_category_id || ']';

        UPDATE categories
        SET name = left(name, 100 - length(_archive_suffix)) || _archive_suffix
        WHERE id = _archived_category_id;
    END IF;

    INSERT INTO categories (user_id, name, kind)
    VALUES (_user_id, _normalized_name, _kind)
    RETURNING id
    INTO _category_id;

    RETURN _category_id;
END
$function$;
