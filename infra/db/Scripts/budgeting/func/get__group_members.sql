-- Description:
--   Returns the configured members of a group with their allocation shares.
-- Parameters:
--   _user_id bigint - Group owner.
--   _group_id bigint - Group category identifier.
-- Returns:
--   jsonb - Array of group members and their shares.
CREATE OR REPLACE FUNCTION budgeting.get__group_members(
    _user_id bigint,
    _group_id bigint
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
    WHERE id = _group_id
      AND user_id = _user_id
      AND kind = 'group';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown group category % for user %', _group_id, _user_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'child_category_id', c.id,
                'child_category_name', c.name,
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
