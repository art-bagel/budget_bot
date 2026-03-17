CREATE OR REPLACE FUNCTION budgeting.get__portfolio_events(
    _user_id bigint,
    _position_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM portfolio_positions
    WHERE id = _position_id;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown portfolio position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to portfolio position %', _position_id;
    END IF;

    SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', pe.id,
                    'position_id', pe.position_id,
                    'event_type', pe.event_type,
                    'event_at', pe.event_at,
                    'quantity', pe.quantity,
                    'amount', pe.amount,
                    'currency_code', pe.currency_code,
                    'linked_operation_id', pe.linked_operation_id,
                    'comment', pe.comment,
                    'metadata', pe.metadata,
                    'created_by_user_id', pe.created_by_user_id,
                    'created_at', pe.created_at
                )
            ORDER BY pe.event_at DESC, pe.id DESC
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM portfolio_events pe
    WHERE pe.position_id = _position_id;

    RETURN _result;
END
$function$;
