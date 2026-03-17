CREATE OR REPLACE FUNCTION budgeting.get__income_source_pattern(
    _user_id          bigint,
    _income_source_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _pattern_id bigint;
    _result     jsonb;
BEGIN
    SET search_path TO budgeting;

    IF NOT EXISTS (
        SELECT 1 FROM income_sources
        WHERE id = _income_source_id AND user_id = _user_id AND is_active
    ) THEN
        RAISE EXCEPTION 'Income source % not found for user', _income_source_id;
    END IF;

    SELECT p.id INTO _pattern_id
    FROM income_source_patterns p
    WHERE p.income_source_id = _income_source_id;

    IF _pattern_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id',               p.id,
        'income_source_id', p.income_source_id,
        'lines', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id',                    l.id,
                    'bank_account_id',       l.bank_account_id,
                    'bank_account_name',     ba.name,
                    'bank_account_owner_type', ba.owner_type,
                    'share',                 l.share
                )
                ORDER BY l.id
            )
            FROM income_source_pattern_lines l
            JOIN bank_accounts ba ON ba.id = l.bank_account_id
            WHERE l.pattern_id = p.id
        )
    )
    INTO _result
    FROM income_source_patterns p
    WHERE p.id = _pattern_id;

    RETURN _result;
END
$function$;
