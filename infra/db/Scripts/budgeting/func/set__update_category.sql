-- Description:
--   Updates the name of an active user category or group.
-- Parameters:
--   _user_id bigint - Category owner.
--   _category_id bigint - Category identifier to update.
--   _name text - New category name.
-- Returns:
--   jsonb - Updated category payload.
CREATE OR REPLACE FUNCTION budgeting.set__update_category(
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
    _normalized_name text := btrim(_name);
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Category name cannot be empty';
    END IF;

    SELECT kind, created_at
    INTO _category_kind, _created_at
    FROM categories
    WHERE id = _category_id
      AND user_id = _user_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category % for user %', _category_id, _user_id;
    END IF;

    IF _category_kind = 'system' THEN
        RAISE EXCEPTION 'System category % cannot be updated', _category_id;
    END IF;

    UPDATE categories
    SET name = _normalized_name
    WHERE id = _category_id;

    RETURN jsonb_build_object(
        'id', _category_id,
        'name', _normalized_name,
        'kind', _category_kind,
        'is_active', true,
        'created_at', _created_at
    );
END
$function$;
