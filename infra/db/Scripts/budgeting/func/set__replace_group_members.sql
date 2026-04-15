-- Description:
--   Replaces the full membership definition of an accessible budget group.
DROP FUNCTION IF EXISTS budgeting.set__replace_group_members;
CREATE FUNCTION budgeting.set__replace_group_members(
    _user_id bigint,
    _group_id bigint,
    _child_category_ids bigint[],
    _shares numeric[]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _idx integer;
    _member_count integer;
    _total_share numeric := 0;
    _group_kind text;
    _child_kind text;
    _child_name text;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _child_owner_type text;
    _child_owner_user_id bigint;
    _child_owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    _member_count := COALESCE(array_length(_child_category_ids, 1), 0);

    IF _member_count = 0 THEN
        RAISE EXCEPTION 'Group must contain at least one child category';
    END IF;

    IF _member_count <> COALESCE(array_length(_shares, 1), 0) THEN
        RAISE EXCEPTION 'Child categories and shares arrays must have the same length';
    END IF;

    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _group_kind, _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _group_id
      AND is_active;

    IF _group_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown group category id: %', _group_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to group category %', _group_id;
    END IF;

    IF _group_kind <> 'group' THEN
        RAISE EXCEPTION 'Category % is not a group', _group_id;
    END IF;

    DELETE FROM group_members
    WHERE group_id = _group_id;

    FOR _idx IN 1.._member_count LOOP
        IF _child_category_ids[_idx] = _group_id THEN
            RAISE EXCEPTION 'Group cannot contain itself';
        END IF;

        IF _shares[_idx] <= 0 OR _shares[_idx] > 1 THEN
            RAISE EXCEPTION 'Invalid group share at position %', _idx;
        END IF;

        SELECT kind, name, owner_type, owner_user_id, owner_family_id
        INTO _child_kind, _child_name, _child_owner_type, _child_owner_user_id, _child_owner_family_id
        FROM categories
        WHERE id = _child_category_ids[_idx]
          AND is_active;

        IF _child_kind IS NULL
           OR (_child_kind = 'system' AND _child_name <> 'Unallocated') THEN
            RAISE EXCEPTION 'Child category % must be an active regular category, group, or Unallocated',
                _child_category_ids[_idx];
        END IF;

        IF _child_owner_type <> _owner_type
           OR COALESCE(_child_owner_user_id, 0) <> COALESCE(_owner_user_id, 0)
           OR COALESCE(_child_owner_family_id, 0) <> COALESCE(_owner_family_id, 0) THEN
            RAISE EXCEPTION 'Group child category % must have the same owner as group %',
                _child_category_ids[_idx],
                _group_id;
        END IF;

        IF _child_kind = 'group' THEN
            PERFORM 1
            FROM (
                WITH RECURSIVE descendants AS (
                    SELECT gm.child_category_id
                    FROM group_members gm
                    WHERE gm.group_id = _child_category_ids[_idx]

                    UNION

                    SELECT gm.child_category_id
                    FROM group_members gm
                    JOIN descendants d
                      ON d.child_category_id = gm.group_id
                )
                SELECT child_category_id
                FROM descendants
            ) graph
            WHERE child_category_id = _group_id;

            IF FOUND THEN
                RAISE EXCEPTION 'Group % cannot contain % because it would create a cycle',
                    _group_id,
                    _child_category_ids[_idx];
            END IF;
        END IF;

        INSERT INTO group_members (group_id, child_category_id, share)
        VALUES (_group_id, _child_category_ids[_idx], _shares[_idx]);

        _total_share := _total_share + _shares[_idx];
    END LOOP;

    IF abs(_total_share - 1) > 0.000001 THEN
        RAISE EXCEPTION 'Group shares must sum to 1, got %', _total_share;
    END IF;

    RETURN jsonb_build_object(
        'group_id', _group_id,
        'members_count', _member_count
    );
END
$function$;
