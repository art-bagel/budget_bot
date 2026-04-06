-- Description:
--   Creates a user income source for income analytics.
-- Parameters:
--   _user_id bigint - Income source owner.
--   _name text - Income source name.
-- Returns:
--   bigint - Identifier of the created income source.
DROP FUNCTION IF EXISTS budgeting.put__create_income_source;
CREATE FUNCTION budgeting.put__create_income_source(
    _user_id bigint,
    _name text
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _income_source_id bigint;
    _normalized_name text := btrim(_name);
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Income source name cannot be empty';
    END IF;

    PERFORM 1
    FROM users
    WHERE id = _user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    INSERT INTO income_sources (user_id, name)
    VALUES (_user_id, _normalized_name)
    RETURNING id
    INTO _income_source_id;

    RETURN _income_source_id;
END
$function$;
