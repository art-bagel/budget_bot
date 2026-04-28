DROP FUNCTION IF EXISTS budgeting.set__close_crypto_protocol_position;
CREATE FUNCTION budgeting.set__close_crypto_protocol_position(
    _user_id bigint,
    _position_id bigint,
    _withdrawn_at date DEFAULT NULL,
    _current_quantity numeric DEFAULT NULL,
    _current_value_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _existing record;
BEGIN
    SET search_path TO budgeting;

    SELECT *
    INTO _existing
    FROM crypto_protocol_positions
    WHERE id = _position_id
    FOR UPDATE;

    IF _existing.id IS NULL THEN
        RAISE EXCEPTION 'Unknown crypto protocol position %', _position_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    UPDATE crypto_protocol_positions
    SET status = 'closed',
        withdrawn_at = COALESCE(_withdrawn_at, current_date),
        current_quantity = COALESCE(_current_quantity, current_quantity),
        current_value_in_base = COALESCE(_current_value_in_base, current_value_in_base),
        comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
        updated_at = current_timestamp
    WHERE id = _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;

