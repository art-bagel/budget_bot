DROP FUNCTION IF EXISTS budgeting.set__ensure_portfolio_position_clean_amount;
CREATE FUNCTION budgeting.set__ensure_portfolio_position_clean_amount(
    _position_id bigint,
    _clean_amount_in_base numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE portfolio_positions
    SET metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('clean_amount_in_base', round(_clean_amount_in_base, 2))
    WHERE id = _position_id
      AND COALESCE(metadata ->> 'clean_amount_in_base', '') = '';
END
$function$;
