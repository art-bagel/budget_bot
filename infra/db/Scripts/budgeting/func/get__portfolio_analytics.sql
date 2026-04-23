DROP FUNCTION IF EXISTS budgeting.get__portfolio_analytics;
CREATE FUNCTION budgeting.get__portfolio_analytics(
    _user_id bigint,
    _date_from date,
    _date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    WITH scoped_accounts AS (
        SELECT
            ba.id,
            ba.name,
            ba.owner_type,
            CASE
                WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                ELSE f.name
            END AS owner_name
        FROM bank_accounts ba
        LEFT JOIN users u
          ON u.id = ba.owner_user_id
        LEFT JOIN families f
          ON f.id = ba.owner_family_id
        WHERE ba.is_active
          AND ba.account_kind = 'investment'
          AND (
                (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
                OR
                (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
              )
    ),

    -- Income events within the period, grouped by month
    monthly_income AS (
        SELECT
            date_trunc('month', pe.event_at)::date AS period,
            pp.asset_type_code,
            pp.investment_account_id,
            COALESCE(pe.metadata ->> 'income_kind', 'other') AS income_kind,
            SUM(COALESCE((pe.metadata ->> 'amount_in_base')::numeric, pe.amount, 0)) AS total_amount,
            COUNT(*) AS events_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type = 'income'
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
        GROUP BY 1, 2, 3, 4
    ),

    -- Close / partial_close events within the period (realized P&L from trades)
    monthly_trades AS (
        SELECT
            date_trunc('month', pe.event_at)::date AS period,
            pp.asset_type_code,
            pp.investment_account_id,
            SUM(
                CASE
                    WHEN pe.event_type = 'close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0),
                                      0)
                    WHEN pe.event_type = 'partial_close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pe.metadata ->> 'principal_amount_in_base')::numeric, 0),
                                      0)
                    ELSE 0
                END
            ) AS total_amount,
            COUNT(*) AS events_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type IN ('close', 'partial_close')
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
        GROUP BY 1, 2, 3
    ),

    -- Adjustment cancellations within the period
    monthly_adjustments AS (
        SELECT
            date_trunc('month', pe.event_at)::date AS period,
            pp.asset_type_code,
            pp.investment_account_id,
            SUM(COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0)) AS total_amount,
            COUNT(*) AS events_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type = 'adjustment'
          AND (pe.metadata ->> 'action') = 'cancel_income'
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
        GROUP BY 1, 2, 3
    ),

    -- Totals by asset type for the entire period
    totals_by_asset_type AS (
        SELECT
            pp.asset_type_code,
            SUM(CASE WHEN pe.event_type = 'income'
                THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, pe.amount, 0) ELSE 0 END) AS income_total,
            SUM(CASE WHEN pe.event_type IN ('close', 'partial_close')
                THEN CASE
                    WHEN pe.event_type = 'close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0),
                                      0)
                    ELSE COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                  (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pe.metadata ->> 'principal_amount_in_base')::numeric, 0),
                                  0)
                END
                ELSE 0 END) AS trade_total,
            SUM(CASE WHEN pe.event_type = 'adjustment' AND (pe.metadata ->> 'action') = 'cancel_income'
                THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0) ELSE 0 END) AS adjustment_total,
            COUNT(*) FILTER (WHERE pe.event_type = 'income') AS income_count,
            COUNT(*) FILTER (WHERE pe.event_type IN ('close', 'partial_close')) AS trade_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type IN ('income', 'close', 'partial_close', 'adjustment')
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
          AND (pe.event_type != 'adjustment' OR (pe.metadata ->> 'action') = 'cancel_income')
        GROUP BY pp.asset_type_code
    ),

    -- Totals by account for the entire period
    totals_by_account AS (
        SELECT
            pp.investment_account_id,
            sa.name AS account_name,
            sa.owner_type,
            sa.owner_name,
            SUM(CASE WHEN pe.event_type = 'income'
                THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, pe.amount, 0) ELSE 0 END) AS income_total,
            SUM(CASE WHEN pe.event_type IN ('close', 'partial_close')
                THEN CASE
                    WHEN pe.event_type = 'close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0),
                                      0)
                    ELSE COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                  (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pe.metadata ->> 'principal_amount_in_base')::numeric, 0),
                                  0)
                END
                ELSE 0 END) AS trade_total,
            SUM(CASE WHEN pe.event_type = 'adjustment' AND (pe.metadata ->> 'action') = 'cancel_income'
                THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0) ELSE 0 END) AS adjustment_total,
            COUNT(*) FILTER (WHERE pe.event_type = 'income') AS income_count,
            COUNT(*) FILTER (WHERE pe.event_type IN ('close', 'partial_close')) AS trade_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type IN ('income', 'close', 'partial_close', 'adjustment')
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
          AND (pe.event_type != 'adjustment' OR (pe.metadata ->> 'action') = 'cancel_income')
        GROUP BY pp.investment_account_id, sa.name, sa.owner_type, sa.owner_name
    ),

    -- Income feed: individual income events with position info
    income_feed AS (
        SELECT
            pe.id AS event_id,
            pe.event_at,
            pp.id AS position_id,
            pp.title AS position_title,
            pp.asset_type_code,
            pp.investment_account_id,
            sa.name AS account_name,
            COALESCE(pe.metadata ->> 'income_kind', 'other') AS income_kind,
            COALESCE((pe.metadata ->> 'amount_in_base')::numeric, pe.amount, 0) AS amount_in_base,
            pe.currency_code,
            pe.amount AS amount_in_currency
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type = 'income'
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
        ORDER BY pe.event_at DESC, pe.id DESC
        LIMIT 50
    ),

    -- Totals by income kind for the entire period
    totals_by_income_kind AS (
        SELECT
            COALESCE(pe.metadata ->> 'income_kind', 'other') AS income_kind,
            SUM(COALESCE((pe.metadata ->> 'amount_in_base')::numeric, pe.amount, 0)) AS total_amount,
            COUNT(*) AS events_count
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        WHERE pe.event_type = 'income'
          AND pe.event_at >= _date_from
          AND pe.event_at <= _date_to
        GROUP BY 1
    )

    SELECT jsonb_build_object(
        'date_from', _date_from,
        'date_to', _date_to,

        'monthly_income', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'period', mi.period,
                'asset_type_code', mi.asset_type_code,
                'investment_account_id', mi.investment_account_id,
                'income_kind', mi.income_kind,
                'total_amount', mi.total_amount,
                'events_count', mi.events_count
            ) ORDER BY mi.period)
            FROM monthly_income mi
        ), '[]'::jsonb),

        'monthly_trades', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'period', mt.period,
                'asset_type_code', mt.asset_type_code,
                'investment_account_id', mt.investment_account_id,
                'total_amount', mt.total_amount,
                'events_count', mt.events_count
            ) ORDER BY mt.period)
            FROM monthly_trades mt
        ), '[]'::jsonb),

        'monthly_adjustments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'period', ma.period,
                'asset_type_code', ma.asset_type_code,
                'investment_account_id', ma.investment_account_id,
                'total_amount', ma.total_amount,
                'events_count', ma.events_count
            ) ORDER BY ma.period)
            FROM monthly_adjustments ma
        ), '[]'::jsonb),

        'totals_by_asset_type', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'asset_type_code', tat.asset_type_code,
                'income_total', tat.income_total,
                'trade_total', tat.trade_total,
                'adjustment_total', tat.adjustment_total,
                'income_count', tat.income_count,
                'trade_count', tat.trade_count
            ))
            FROM totals_by_asset_type tat
        ), '[]'::jsonb),

        'totals_by_account', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'investment_account_id', tba.investment_account_id,
                'account_name', tba.account_name,
                'owner_type', tba.owner_type,
                'owner_name', tba.owner_name,
                'income_total', tba.income_total,
                'trade_total', tba.trade_total,
                'adjustment_total', tba.adjustment_total,
                'income_count', tba.income_count,
                'trade_count', tba.trade_count
            ))
            FROM totals_by_account tba
        ), '[]'::jsonb),

        'totals_by_income_kind', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'income_kind', tik.income_kind,
                'total_amount', tik.total_amount,
                'events_count', tik.events_count
            ))
            FROM totals_by_income_kind tik
        ), '[]'::jsonb),

        'income_feed', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'event_id', f.event_id,
                'event_at', f.event_at,
                'position_id', f.position_id,
                'position_title', f.position_title,
                'asset_type_code', f.asset_type_code,
                'investment_account_id', f.investment_account_id,
                'account_name', f.account_name,
                'income_kind', f.income_kind,
                'amount_in_base', f.amount_in_base,
                'currency_code', f.currency_code,
                'amount_in_currency', f.amount_in_currency
            ))
            FROM income_feed f
        ), '[]'::jsonb)
    )
    INTO _result;

    RETURN _result;
END
$function$;
