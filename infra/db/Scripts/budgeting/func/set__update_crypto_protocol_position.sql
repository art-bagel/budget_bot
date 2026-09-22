DROP FUNCTION IF EXISTS budgeting.set__update_crypto_protocol_position;
CREATE FUNCTION budgeting.set__update_crypto_protocol_position(
    _user_id bigint,
    _position_id bigint,
    _quantity numeric DEFAULT NULL,
    _current_quantity numeric DEFAULT NULL,
    _current_value_in_base numeric DEFAULT NULL,
    _rewards_claimed_in_base numeric DEFAULT NULL,
    _rewards_unclaimed_in_base numeric DEFAULT NULL,
    _comment text DEFAULT NULL,
    _metadata jsonb DEFAULT NULL
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

    IF _existing.status <> 'open' THEN
        RAISE EXCEPTION 'Closed protocol position cannot be updated';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _existing.owner_type, _existing.owner_user_id, _existing.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to protocol position %', _position_id;
    END IF;

    IF (_existing.metadata ->> 'debt_accounting_version') = '2'
       AND COALESCE(_metadata, '{}'::jsonb) ?| ARRAY[
           'borrowed_quantity', 'borrowed_value_in_base', 'debt_cost_basis_in_base',
           'debt_interest_quantity', 'debt_interest_basis_in_base',
           'debt_accounting_version', 'borrowed_crypto_asset_id', 'borrowed_position_id'] THEN
        RAISE EXCEPTION 'Version-2 debt must be changed through lending events';
    END IF;

    IF ((_existing.metadata->>'debt_accounting_version')='2'
        OR EXISTS(SELECT 1 FROM crypto_protocol_accrual_events WHERE protocol_position_id=_position_id))
       AND ((_quantity IS NOT NULL AND _quantity IS DISTINCT FROM _existing.quantity)
         OR (_current_quantity IS NOT NULL AND _current_quantity IS DISTINCT FROM _existing.current_quantity)) THEN
        RAISE EXCEPTION 'Lending quantities must be changed through protocol events';
    END IF;

    UPDATE crypto_protocol_positions
    SET quantity = COALESCE(_quantity, quantity),
        current_quantity = COALESCE(_current_quantity, current_quantity),
        current_value_in_base = COALESCE(_current_value_in_base, current_value_in_base),
        rewards_claimed_in_base = COALESCE(_rewards_claimed_in_base, rewards_claimed_in_base),
        rewards_unclaimed_in_base = COALESCE(_rewards_unclaimed_in_base, rewards_unclaimed_in_base),
        comment = COALESCE(NULLIF(btrim(_comment), ''), comment),
        metadata = CASE WHEN _metadata IS NULL THEN metadata ELSE metadata || _metadata END,
        updated_at = current_timestamp
    WHERE id = _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _existing.investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;

