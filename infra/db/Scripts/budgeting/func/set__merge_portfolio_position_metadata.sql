CREATE OR REPLACE FUNCTION budgeting.set__merge_portfolio_position_metadata(
    _position_id bigint,
    _next_title text DEFAULT NULL,
    _metadata_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE portfolio_positions
    SET title = CASE
                    WHEN NULLIF(btrim(COALESCE(_next_title, '')), '') IS NULL THEN title
                    ELSE NULLIF(btrim(_next_title), '')
                END,
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(_metadata_patch, '{}'::jsonb)
    WHERE id = _position_id;
END
$function$;
