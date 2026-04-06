DROP FUNCTION IF EXISTS budgeting.put__invite_family_member;
CREATE FUNCTION budgeting.put__invite_family_member(
    _user_id bigint,
    _username text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _invited_user_id bigint;
    _base_currency_code char(3);
    _invitation_id bigint;
    _normalized_username text := ltrim(btrim(_username), '@');
BEGIN
    SET search_path TO budgeting;

    IF _normalized_username = '' THEN
        RAISE EXCEPTION 'Username cannot be empty';
    END IF;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _family_id IS NULL THEN
        RAISE EXCEPTION 'User % does not belong to a family', _user_id;
    END IF;

    PERFORM 1
    FROM family_members
    WHERE family_id = _family_id
      AND user_id = _user_id
      AND role = 'owner';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Only family owner can invite members';
    END IF;

    SELECT u.id, u.base_currency_code
    INTO _invited_user_id, _base_currency_code
    FROM users u
    WHERE lower(u.username) = lower(_normalized_username);

    IF _invited_user_id IS NULL THEN
        RAISE EXCEPTION 'Unknown registered username: %', _normalized_username;
    END IF;

    IF _invited_user_id = _user_id THEN
        RAISE EXCEPTION 'User cannot invite themselves';
    END IF;

    IF budgeting.get__user_family_id(_invited_user_id) IS NOT NULL THEN
        RAISE EXCEPTION 'User % already belongs to a family', _invited_user_id;
    END IF;

    IF _base_currency_code <> budgeting.get__owner_base_currency('family', NULL, _family_id) THEN
        RAISE EXCEPTION 'Invited user must have the same base currency as the family';
    END IF;

    PERFORM 1
    FROM family_invitations
    WHERE family_id       = _family_id
      AND invited_user_id = _invited_user_id
      AND status          = 'pending';

    IF FOUND THEN
        RAISE EXCEPTION 'User % already has a pending invitation to this family', _invited_user_id;
    END IF;

    INSERT INTO family_invitations (family_id, invited_user_id, invited_by_user_id, status)
    VALUES (_family_id, _invited_user_id, _user_id, 'pending')
    RETURNING id
    INTO _invitation_id;

    RETURN jsonb_build_object(
        'invitation_id', _invitation_id,
        'family_id', _family_id,
        'invited_user_id', _invited_user_id,
        'status', 'pending'
    );
END
$function$;
