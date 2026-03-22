CREATE OR REPLACE FUNCTION budgeting.get__portfolio_position_trade_context(
    _position_id bigint
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    SELECT jsonb_build_object(
        'quantity', pp.quantity,
        'amount_in_currency', pp.amount_in_currency,
        'amount_in_base', COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0),
        'clean_amount_in_base', (pp.metadata ->> 'clean_amount_in_base')::numeric
    )
    FROM budgeting.portfolio_positions pp
    WHERE pp.id = _position_id
$function$;
