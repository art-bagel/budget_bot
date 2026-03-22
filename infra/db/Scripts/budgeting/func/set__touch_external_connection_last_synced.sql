CREATE OR REPLACE FUNCTION budgeting.set__touch_external_connection_last_synced(
    _connection_id bigint
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE external_connections
    SET last_synced_at = now()
    WHERE id = _connection_id;
END
$function$;
