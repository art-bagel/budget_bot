DROP FUNCTION IF EXISTS budgeting.set__mark_portfolio_event_imported;
CREATE FUNCTION budgeting.set__mark_portfolio_event_imported(
    _position_id bigint,
    _event_types varchar[],
    _external_id text,
    _import_source varchar(30),
    _metadata_action text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _event_id bigint;
BEGIN
    SET search_path TO budgeting;

    WITH target_event AS (
        SELECT id
        FROM portfolio_events
        WHERE position_id = _position_id
          AND event_type = ANY(_event_types)
          AND external_id IS NULL
          AND (
              _metadata_action IS NULL
              OR COALESCE(metadata ->> 'action', '') = _metadata_action
          )
        ORDER BY id DESC
        LIMIT 1
    )
    UPDATE portfolio_events pe
    SET external_id = _external_id,
        import_source = _import_source
    FROM target_event
    WHERE pe.id = target_event.id
    RETURNING pe.id INTO _event_id;

    RETURN _event_id;
END
$function$;
