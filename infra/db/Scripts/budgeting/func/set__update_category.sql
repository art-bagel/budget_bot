-- Description:
--   Updates the name of an active accessible category or group.
DROP FUNCTION IF EXISTS budgeting.set__update_category;
CREATE FUNCTION budgeting.set__update_category(
    _user_id bigint,
    _category_id bigint,
    _name text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_kind text;
    _created_at timestamptz;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _normalized_name text := btrim(_name);
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Category name cannot be empty';
    END IF;

    SELECT kind, created_at, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _created_at, _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _category_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    IF _category_kind = 'system' THEN
        RAISE EXCEPTION 'System category % cannot be updated', _category_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM categories
        WHERE owner_type = _owner_type
          AND ((_owner_type = 'user'   AND owner_user_id   = _owner_user_id)
               OR (_owner_type = 'family' AND owner_family_id = _owner_family_id))
          AND name      = _normalized_name
          AND is_active
          AND id <> _category_id
    ) THEN
        RAISE EXCEPTION 'Active category with name "%" already exists', _normalized_name;
    END IF;

    UPDATE categories
    SET name = _normalized_name
    WHERE id = _category_id;

    RETURN jsonb_build_object(
        'id', _category_id,
        'name', _normalized_name,
        'kind', _category_kind,
        'owner_type', _owner_type,
        'owner_user_id', _owner_user_id,
        'owner_family_id', _owner_family_id,
        'is_active', true,
        'created_at', _created_at
    );
END
$function$;
