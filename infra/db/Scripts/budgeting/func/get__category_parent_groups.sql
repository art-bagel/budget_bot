-- Description:
--   Returns active parent groups that contain the specified category or group.
-- Parameters:
--   _user_id bigint - Owner of the category.
--   _category_id bigint - Category or group identifier.
-- Returns:
--   jsonb - Array of parent groups.
CREATE OR REPLACE FUNCTION budgeting.get__category_parent_groups(
    _user_id bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    PERFORM 1
    FROM categories
    WHERE id = _category_id
      AND user_id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown category % for user %', _category_id, _user_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'group_id', parent.id,
                'group_name', parent.name
            )
            ORDER BY parent.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM group_members gm
    JOIN categories parent
      ON parent.id = gm.group_id
    WHERE gm.child_category_id = _category_id
      AND parent.user_id = _user_id
      AND parent.is_active;

    RETURN _result;
END
$function$;
