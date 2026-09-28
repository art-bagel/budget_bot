DROP FUNCTION IF EXISTS budgeting.put__crypto_pay_fee;
CREATE FUNCTION budgeting.put__crypto_pay_fee(
    _user_id bigint,
    _source_position_id bigint,
    _quantity numeric,
    _comment text DEFAULT NULL,
    _operated_at date DEFAULT NULL,
    _link_protocol_position_id bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
BEGIN
    RETURN budgeting.put__crypto_consume(_user_id, _source_position_id, _quantity,
        'fee', _comment, _operated_at, _link_protocol_position_id);
END
$function$;
