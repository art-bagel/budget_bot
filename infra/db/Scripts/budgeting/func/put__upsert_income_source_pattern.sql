CREATE OR REPLACE FUNCTION budgeting.put__upsert_income_source_pattern(
    _user_id          bigint,
    _income_source_id bigint,
    _lines            jsonb   -- [{bank_account_id, share}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _pattern_id  bigint;
    _line        jsonb;
    _total_share numeric;
    _ba_id       bigint;
BEGIN
    SET search_path TO budgeting;

    IF NOT EXISTS (
        SELECT 1 FROM income_sources
        WHERE id = _income_source_id AND user_id = _user_id AND is_active
    ) THEN
        RAISE EXCEPTION 'Income source % not found for user', _income_source_id;
    END IF;

    IF jsonb_array_length(_lines) = 0 THEN
        RAISE EXCEPTION 'Pattern must have at least one line';
    END IF;

    SELECT SUM((line->>'share')::numeric)
    INTO _total_share
    FROM jsonb_array_elements(_lines) AS line;

    IF ABS(_total_share - 1.0) > 0.001 THEN
        RAISE EXCEPTION 'Pattern shares must sum to 1.0, got %', _total_share;
    END IF;

    -- Validate that each bank account is accessible by user
    FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
        _ba_id := (_line->>'bank_account_id')::bigint;
        IF NOT EXISTS (
            SELECT 1 FROM bank_accounts ba
            WHERE ba.id = _ba_id
              AND ba.is_active
              AND budgeting.has__owner_access(_user_id, ba.owner_type, ba.owner_user_id, ba.owner_family_id)
        ) THEN
            RAISE EXCEPTION 'Bank account % is not accessible', _ba_id;
        END IF;
    END LOOP;

    -- Upsert pattern record
    INSERT INTO income_source_patterns (income_source_id, created_by_user_id)
    VALUES (_income_source_id, _user_id)
    ON CONFLICT (income_source_id) DO UPDATE
        SET income_source_id = EXCLUDED.income_source_id
    RETURNING id INTO _pattern_id;

    -- Replace all lines
    DELETE FROM income_source_pattern_lines WHERE pattern_id = _pattern_id;

    INSERT INTO income_source_pattern_lines (pattern_id, bank_account_id, share)
    SELECT _pattern_id,
           (line->>'bank_account_id')::bigint,
           (line->>'share')::numeric
    FROM jsonb_array_elements(_lines) AS line;

    RETURN jsonb_build_object('id', _pattern_id);
END
$function$;
