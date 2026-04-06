-- Description:
--   Removes a non-owner member from their family.
--   The owner cannot leave — they must use set__dissolve_family instead.
DROP FUNCTION IF EXISTS budgeting.set__leave_family;
CREATE FUNCTION budgeting.set__leave_family(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _role text;
    _family_owner_user_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT fm.family_id, fm.role, f.created_by_user_id
    INTO _family_id, _role, _family_owner_user_id
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

    -- Family data should stay intact after a member leaves, so move audit links
    -- away from the departing user before removing their membership.
    UPDATE scheduled_expenses
    SET created_by_user_id = _family_owner_user_id
    WHERE owner_type = 'family'
      AND owner_family_id = _family_id
      AND created_by_user_id = _user_id;

    UPDATE portfolio_positions
    SET created_by_user_id = _family_owner_user_id
    WHERE owner_type = 'family'
      AND owner_family_id = _family_id
      AND created_by_user_id = _user_id;

    UPDATE portfolio_events pe
    SET created_by_user_id = _family_owner_user_id
    FROM portfolio_positions pp
    WHERE pe.position_id = pp.id
      AND pp.owner_type = 'family'
      AND pp.owner_family_id = _family_id
      AND pe.created_by_user_id = _user_id;

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
