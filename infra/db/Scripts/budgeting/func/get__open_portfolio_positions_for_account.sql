DROP FUNCTION IF EXISTS budgeting.get__open_portfolio_positions_for_account;
CREATE FUNCTION budgeting.get__open_portfolio_positions_for_account(
    _investment_account_id bigint
)
RETURNS jsonb
LANGUAGE sql
AS $function$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', pp.id,
                'title', pp.title,
                'metadata', pp.metadata
            )
            ORDER BY pp.id
        ),
        '[]'::jsonb
    )
    FROM budgeting.portfolio_positions pp
    WHERE pp.investment_account_id = _investment_account_id
      AND pp.status = 'open'
$function$;
