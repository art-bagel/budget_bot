-- Description:
--   Archives a user income source. The name is kept, so past operations still
--   show it; creating a source with the same name brings it back.
-- Parameters:
--   _user_id bigint - Income source owner.
--   _income_source_id bigint - Income source to archive.
-- Returns:
--   jsonb - Archived income source.
DROP FUNCTION IF EXISTS budgeting.set__archive_income_source;
CREATE FUNCTION budgeting.set__archive_income_source(
    _user_id bigint,
    _income_source_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    UPDATE income_sources
    SET is_active = false
    WHERE id = _income_source_id
      AND user_id = _user_id
      AND is_active
    RETURNING jsonb_build_object('id', id, 'name', name, 'is_active', is_active, 'created_at', created_at)
    INTO _result;

    IF _result IS NULL THEN
        RAISE EXCEPTION 'Unknown active income source %', _income_source_id;
    END IF;

    RETURN _result;
END
$function$;
