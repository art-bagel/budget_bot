-- Description:
--   Removes a non-owner member from their family.
--   The owner cannot leave — they must use set__dissolve_family instead.
CREATE OR REPLACE FUNCTION budgeting.set__leave_family(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _role text;
BEGIN
    SET search_path TO budgeting;

    SELECT fm.family_id, fm.role
    INTO _family_id, _role
    FROM family_members fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = _user_id
      AND f.is_active;

    IF _family_id IS NULL THEN
        RAISE EXCEPTION 'User % does not belong to a family', _user_id;
    END IF;

    IF _role = 'owner' THEN
        RAISE EXCEPTION 'Family owner cannot leave — use set__dissolve_family to dissolve the family';
    END IF;

    DELETE FROM family_members
    WHERE family_id = _family_id
      AND user_id = _user_id;

    RETURN jsonb_build_object(
        'status', 'left',
        'user_id', _user_id,
        'family_id', _family_id
    );
END
$function$;
