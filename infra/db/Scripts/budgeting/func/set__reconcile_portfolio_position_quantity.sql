DROP FUNCTION IF EXISTS budgeting.set__reconcile_portfolio_position_quantity;
CREATE FUNCTION budgeting.set__reconcile_portfolio_position_quantity(
    _position_id bigint,
    _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE portfolio_positions
    SET asset_type_code = 'security',
        quantity = _quantity
    WHERE id = _position_id;
END
$function$;
