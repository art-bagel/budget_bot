-- Description:
--   Returns active parent groups that contain the specified category or group.
DROP FUNCTION IF EXISTS budgeting.get__category_parent_groups;
CREATE FUNCTION budgeting.get__category_parent_groups(
    _user_id bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _category_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown category %', _category_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
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
      AND parent.is_active;

    RETURN _result;
END
$function$;
