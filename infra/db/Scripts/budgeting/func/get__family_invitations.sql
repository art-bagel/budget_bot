DROP FUNCTION IF EXISTS budgeting.get__family_invitations;
CREATE FUNCTION budgeting.get__family_invitations(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'invitation_id', fi.id,
                'family_id', fi.family_id,
                'family_name', f.name,
                'invited_by_user_id', fi.invited_by_user_id,
                'invited_by_username', inviter.username,
                'status', fi.status,
                'created_at', fi.created_at,
                'responded_at', fi.responded_at
            )
            ORDER BY fi.created_at DESC, fi.id DESC
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM family_invitations fi
    JOIN families f
      ON f.id = fi.family_id
    JOIN users inviter
      ON inviter.id = fi.invited_by_user_id
    WHERE fi.invited_user_id = _user_id;

    RETURN _result;
END
$function$;
