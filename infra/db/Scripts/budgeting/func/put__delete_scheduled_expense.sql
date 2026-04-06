DROP FUNCTION IF EXISTS budgeting.put__delete_scheduled_expense;
CREATE FUNCTION budgeting.put__delete_scheduled_expense(
    _user_id     bigint,
    _schedule_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type     text;
    _owner_user_id  bigint;
    _owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM scheduled_expenses
    WHERE id = _schedule_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Scheduled expense % not found', _schedule_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to scheduled expense %', _schedule_id;
    END IF;

    DELETE FROM scheduled_expenses WHERE id = _schedule_id;

    RETURN TRUE;
END
$function$;
