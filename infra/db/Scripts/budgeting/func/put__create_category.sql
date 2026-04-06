-- Description:
--   Creates a personal or family category for budget tracking.
DROP FUNCTION IF EXISTS budgeting.put__create_category;
CREATE FUNCTION budgeting.put__create_category(
    _user_id bigint,
    _name text,
    _kind text,
    _owner_type text DEFAULT 'user'
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_id bigint;
    _archived_category_id bigint;
    _archive_suffix text;
    _normalized_name text := btrim(_name);
    _owner_user_id bigint;
    _owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Category name cannot be empty';
    END IF;

    IF _kind NOT IN ('regular', 'group') THEN
        RAISE EXCEPTION 'Unsupported category kind: %', _kind;
    END IF;

    IF _owner_type = 'user' THEN
        _owner_user_id := _user_id;
    ELSIF _owner_type = 'family' THEN
        _owner_family_id := budgeting.get__user_family_id(_user_id);

        IF _owner_family_id IS NULL THEN
            RAISE EXCEPTION 'User % does not belong to a family', _user_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported category owner type: %', _owner_type;
    END IF;

    IF EXISTS (
        SELECT 1 FROM categories c
        WHERE c.owner_type = _owner_type
          AND ((_owner_type = 'user'   AND c.owner_user_id   = _owner_user_id)
               OR (_owner_type = 'family' AND c.owner_family_id = _owner_family_id))
          AND c.name      = _normalized_name
          AND c.is_active
    ) THEN
        RAISE EXCEPTION 'Active category with name "%" already exists', _normalized_name;
    END IF;

    SELECT c.id
    INTO _archived_category_id
    FROM categories c
    WHERE c.owner_type = _owner_type
      AND (
            (_owner_type = 'user' AND c.owner_user_id = _owner_user_id)
            OR
            (_owner_type = 'family' AND c.owner_family_id = _owner_family_id)
          )
      AND c.name = _normalized_name
      AND NOT c.is_active
    LIMIT 1;

    IF _archived_category_id IS NOT NULL THEN
        _archive_suffix := ' [archived ' || _archived_category_id || ']';

        UPDATE categories
        SET name = left(name, 100 - length(_archive_suffix)) || _archive_suffix
        WHERE id = _archived_category_id;
    END IF;

    INSERT INTO categories (owner_type, owner_user_id, owner_family_id, name, kind)
    VALUES (_owner_type, _owner_user_id, _owner_family_id, _normalized_name, _kind)
    RETURNING id
    INTO _category_id;

    RETURN _category_id;
END
$function$;
