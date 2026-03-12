-- Description:
--   Returns the configured members of a group with their allocation shares.
CREATE OR REPLACE FUNCTION budgeting.get__group_members(
    _user_id bigint,
    _group_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _kind text;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id, kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _kind
    FROM categories
    WHERE id = _group_id
      AND is_active;

    IF _kind IS NULL THEN
        RAISE EXCEPTION 'Unknown group category %', _group_id;
    END IF;

    IF _kind <> 'group' THEN
        RAISE EXCEPTION 'Category % is not a group', _group_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to group category %', _group_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'child_category_id', c.id,
                'child_category_name', c.name,
                'child_category_kind', c.kind,
                'child_owner_type', c.owner_type,
                'share', gm.share
            )
            ORDER BY c.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM group_members gm
    JOIN categories c
      ON c.id = gm.child_category_id
    WHERE gm.group_id = _group_id;

    RETURN _result;
END
$function$;
