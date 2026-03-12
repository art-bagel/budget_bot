CREATE OR REPLACE FUNCTION budgeting.set__respond_family_invitation(
    _user_id bigint,
    _invitation_id bigint,
    _accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _status text;
BEGIN
    SET search_path TO budgeting;

    SELECT fi.family_id, fi.status
    INTO _family_id, _status
    FROM family_invitations fi
    WHERE fi.id = _invitation_id
      AND fi.invited_user_id = _user_id;

    IF _family_id IS NULL THEN
        RAISE EXCEPTION 'Unknown invitation % for user %', _invitation_id, _user_id;
    END IF;

    IF _status <> 'pending' THEN
        RAISE EXCEPTION 'Invitation % is already %', _invitation_id, _status;
    END IF;

    IF _accept THEN
        IF budgeting.get__user_family_id(_user_id) IS NOT NULL THEN
            RAISE EXCEPTION 'User % already belongs to a family', _user_id;
        END IF;

        INSERT INTO family_members (family_id, user_id, role)
        VALUES (_family_id, _user_id, 'member');

        UPDATE family_invitations
        SET status = 'accepted',
            responded_at = current_timestamp
        WHERE id = _invitation_id;

        RETURN jsonb_build_object(
            'invitation_id', _invitation_id,
            'family_id', _family_id,
            'status', 'accepted'
        );
    END IF;

    UPDATE family_invitations
    SET status = 'declined',
        responded_at = current_timestamp
    WHERE id = _invitation_id;

    RETURN jsonb_build_object(
        'invitation_id', _invitation_id,
        'family_id', _family_id,
        'status', 'declined'
    );
END
$function$;
