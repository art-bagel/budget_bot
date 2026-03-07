-- Description:
--   Archives a user category or group and removes its group bindings.
-- Parameters:
--   _user_id bigint - Category owner.
--   _category_id bigint - Category identifier to archive.
-- Returns:
--   jsonb - Archived category identifier and kind.
CREATE OR REPLACE FUNCTION budgeting.set__archive_category(
    _user_id bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_kind text;
    _category_name text;
BEGIN
    SET search_path TO budgeting;

    SELECT kind, name
    INTO _category_kind, _category_name
    FROM categories
    WHERE id = _category_id
      AND user_id = _user_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category % for user %', _category_id, _user_id;
    END IF;

    IF _category_kind = 'system' THEN
        RAISE EXCEPTION 'System category % cannot be archived', _category_id;
    END IF;

    DELETE FROM group_members
    WHERE group_id = _category_id
       OR child_category_id = _category_id;

    UPDATE categories
    SET is_active = false
    WHERE id = _category_id;

    RETURN jsonb_build_object(
        'category_id', _category_id,
        'kind', _category_kind,
        'name', _category_name,
        'is_active', false
    );
END
$function$;
