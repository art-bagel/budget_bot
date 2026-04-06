DROP FUNCTION IF EXISTS budgeting.put__delete_income_source_pattern;
CREATE FUNCTION budgeting.put__delete_income_source_pattern(
    _user_id          bigint,
    _income_source_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    _deleted_count int;
BEGIN
    SET search_path TO budgeting;

    IF NOT EXISTS (
        SELECT 1 FROM income_sources
        WHERE id = _income_source_id AND user_id = _user_id
    ) THEN
        RAISE EXCEPTION 'Income source % not found for user', _income_source_id;
    END IF;

    DELETE FROM income_source_patterns WHERE income_source_id = _income_source_id;
    GET DIAGNOSTICS _deleted_count = ROW_COUNT;

    RETURN _deleted_count > 0;
END
$function$;
