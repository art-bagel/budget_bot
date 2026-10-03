DROP FUNCTION IF EXISTS budgeting.get__portfolio_summary;
CREATE FUNCTION budgeting.get__portfolio_summary(
    _user_id bigint
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
            ba.investment_asset_type,
            budgeting.get__owner_base_currency(ba.owner_type, ba.owner_user_id, ba.owner_family_id) AS base_currency_code,
            ba.include_in_statistics,
            ba.owner_type,
            ba.owner_user_id,
            ba.owner_family_id,
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
          AND NOT ba.is_archived
          AND (
                (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
                OR
                (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
              )
    ),
    currency_rows AS (
        SELECT cbb.bank_account_id, cbb.currency_code, cbb.amount,
            cbb.historical_cost_in_base, sa.base_currency_code,
            CASE WHEN cbb.currency_code = sa.base_currency_code THEN 1 ELSE fx.rate END AS rate,
            fx.fetched_at,
            CASE WHEN cbb.currency_code = sa.base_currency_code THEN cbb.amount
                ELSE round(cbb.amount * fx.rate, 2) END AS market_value_in_base
        FROM current_bank_balances cbb
        JOIN scoped_accounts sa ON sa.id = cbb.bank_account_id AND sa.investment_asset_type = 'currency'
        LEFT JOIN LATERAL (
            SELECT rate, fetched_at FROM fx_rate_snapshots
            WHERE base_currency_code = sa.base_currency_code AND quote_currency_code = cbb.currency_code
                AND fetched_at <= current_timestamp
            ORDER BY fetched_at DESC LIMIT 1
        ) fx ON true
        WHERE cbb.amount <> 0
    ),
    currency_by_account AS (
        SELECT bank_account_id,
            COALESCE(sum(market_value_in_base), 0) AS market_value_in_base,
            bool_and(rate IS NOT NULL) AS valuation_complete,
            jsonb_agg(jsonb_build_object(
                'currency_code', currency_code, 'amount', amount,
                'historical_cost_in_base', historical_cost_in_base,
                'base_currency_code', base_currency_code,
                'rate', rate, 'fetched_at', fetched_at,
                'market_value_in_base', market_value_in_base,
                'unrealized_result_in_base', market_value_in_base - historical_cost_in_base
            ) ORDER BY currency_code) AS balances
        FROM currency_rows GROUP BY bank_account_id
    ),
    cash_by_account AS (
        SELECT
            cbb.bank_account_id,
            COALESCE(sum(cbb.historical_cost_in_base), 0) AS cash_balance_in_base
        FROM current_bank_balances cbb
        JOIN scoped_accounts sa
          ON sa.id = cbb.bank_account_id
        GROUP BY cbb.bank_account_id
    ),
    principal_by_account AS (
        SELECT
            pp.investment_account_id,
            count(*) FILTER (WHERE pp.status = 'open') AS open_positions_count,
            COALESCE(sum(
                CASE
                    WHEN pp.status = 'open' THEN COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0)
                    ELSE 0
                END
            ), 0) AS invested_principal_in_base
        FROM portfolio_positions pp
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        GROUP BY pp.investment_account_id
    ),
    income_by_account AS (
        SELECT
            pp.investment_account_id,
            COALESCE(sum(
                CASE
                    WHEN pe.event_type = 'income' THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0)
                    WHEN pp.asset_type_code = 'crypto' AND pe.event_type IN ('close', 'partial_close') THEN 0
                    WHEN pe.event_type = 'close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pp.metadata ->> 'amount_in_base')::numeric, 0),
                                      0)
                    WHEN pe.event_type = 'partial_close'
                        THEN COALESCE((pe.metadata ->> 'realized_result_in_base')::numeric,
                                      (pe.metadata ->> 'amount_in_base')::numeric - COALESCE((pe.metadata ->> 'principal_amount_in_base')::numeric, 0),
                                      0)
                    WHEN pe.event_type = 'adjustment' AND (pe.metadata ->> 'action') = 'cancel_income'
                        THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0)
                    ELSE 0
                END
            ), 0) AS realized_income_in_base
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        GROUP BY pp.investment_account_id
    ),
    position_flow_by_account AS (
        SELECT
            pp.investment_account_id,
            COALESCE(sum(
                CASE
                    WHEN pe.event_type IN ('partial_close', 'close')
                        THEN COALESCE((pe.metadata ->> 'principal_amount_in_base')::numeric, 0)
                    ELSE 0
                END
            ), 0) AS returned_principal_in_base,
            COALESCE(sum(
                CASE
                    WHEN pe.event_type = 'income' AND COALESCE(pe.metadata ->> 'destination', 'account') = 'position'
                        THEN COALESCE((pe.metadata ->> 'amount_in_base')::numeric, 0)
                    ELSE 0
                END
            ), 0) AS reinvested_income_in_base
        FROM portfolio_events pe
        JOIN portfolio_positions pp
          ON pp.id = pe.position_id
        JOIN scoped_accounts sa
          ON sa.id = pp.investment_account_id
        GROUP BY pp.investment_account_id
    ),
    contribution_entries AS (
        SELECT
            sa.id AS bank_account_id,
            sa.owner_type,
            sa.owner_user_id,
            sa.owner_family_id,
            be.operation_id,
            be.currency_code,
            be.amount
        FROM bank_entries be
        JOIN scoped_accounts sa
          ON sa.id = be.bank_account_id
        JOIN operations o
          ON o.id = be.operation_id
        LEFT JOIN operations ro
          ON ro.id = o.reversal_of_operation_id
        WHERE (
                o.type IN ('broker_input', 'broker_output', 'account_transfer')
                OR (
                    o.type = 'investment_adjustment'
                    AND be.amount < 0
                    AND NOT EXISTS (
                        SELECT 1
                        FROM portfolio_events pe
                        WHERE pe.linked_operation_id = o.id
                    )
                )
                OR (
                    o.type = 'reversal'
                    AND ro.type IN ('broker_input', 'broker_output', 'account_transfer')
                )
                OR (
                    o.type = 'reversal'
                    AND ro.type = 'investment_adjustment'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM portfolio_events pe
                        WHERE pe.linked_operation_id = ro.id
                    )
                )
              )
    ),
    contribution_amounts AS (
        SELECT
            ce.bank_account_id,
            CASE
                WHEN ce.currency_code = budgeting.get__owner_base_currency(ce.owner_type, ce.owner_user_id, ce.owner_family_id)
                    THEN round(ce.amount, 2)
                WHEN ce.amount > 0
                    THEN COALESCE((
                        SELECT sum(fl.cost_base_initial)
                        FROM fx_lots fl
                        WHERE fl.opened_by_operation_id = ce.operation_id
                          AND fl.bank_account_id = ce.bank_account_id
                          AND fl.currency_code = ce.currency_code
                    ), round(ce.amount, 2))
                WHEN ce.amount < 0
                    THEN -COALESCE((
                        SELECT sum(lc.cost_base)
                        FROM lot_consumptions lc
                        JOIN fx_lots fl
                          ON fl.id = lc.lot_id
                        WHERE lc.operation_id = ce.operation_id
                          AND fl.bank_account_id = ce.bank_account_id
                          AND fl.currency_code = ce.currency_code
                    ), round(abs(ce.amount), 2))
                ELSE 0
            END AS amount_in_base
        FROM contribution_entries ce
    ),
    contributions_by_account AS (
        SELECT
            ca.bank_account_id,
            COALESCE(sum(ca.amount_in_base), 0) AS net_contributed_in_base,
            COALESCE(sum(CASE WHEN ca.amount_in_base > 0 THEN ca.amount_in_base ELSE 0 END), 0) AS gross_contributed_in_base,
            COALESCE(sum(CASE WHEN ca.amount_in_base < 0 THEN abs(ca.amount_in_base) ELSE 0 END), 0) AS gross_withdrawn_in_base
        FROM contribution_amounts ca
        GROUP BY ca.bank_account_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'investment_account_id', sa.id,
                'investment_asset_type', sa.investment_asset_type,
                'include_in_statistics', sa.include_in_statistics,
                'investment_account_name', sa.name,
                'investment_account_owner_type', sa.owner_type,
                'investment_account_owner_name', sa.owner_name,
                'cash_balance_in_base', COALESCE(ca.cash_balance_in_base, 0),
                'cash_market_value_in_base', CASE WHEN sa.investment_asset_type = 'currency'
                    THEN COALESCE(cr.market_value_in_base, 0) ELSE COALESCE(ca.cash_balance_in_base, 0) END,
                'cash_valuation_complete', COALESCE(cr.valuation_complete, true),
                'currency_balances', COALESCE(cr.balances, '[]'::jsonb),
                'invested_principal_in_base', COALESCE(pa.invested_principal_in_base, 0),
                'realized_income_in_base', COALESCE(ia.realized_income_in_base, 0),
                'position_contributed_in_base',
                  GREATEST(
                    0,
                    COALESCE(pa.invested_principal_in_base, 0)
                    + COALESCE(pfa.returned_principal_in_base, 0)
                    - COALESCE(pfa.reinvested_income_in_base, 0)
                  ),
                'position_returned_in_base', COALESCE(pfa.returned_principal_in_base, 0),
                'net_contributed_in_base', COALESCE(coa.net_contributed_in_base, 0),
                'gross_contributed_in_base', COALESCE(coa.gross_contributed_in_base, 0),
                'gross_withdrawn_in_base', COALESCE(coa.gross_withdrawn_in_base, 0),
                'open_positions_count', COALESCE(pa.open_positions_count, 0)
            )
            ORDER BY sa.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM scoped_accounts sa
    LEFT JOIN currency_by_account cr ON cr.bank_account_id = sa.id
    LEFT JOIN cash_by_account ca
      ON ca.bank_account_id = sa.id
    LEFT JOIN principal_by_account pa
      ON pa.investment_account_id = sa.id
    LEFT JOIN income_by_account ia
      ON ia.investment_account_id = sa.id
    LEFT JOIN position_flow_by_account pfa
      ON pfa.investment_account_id = sa.id
    LEFT JOIN contributions_by_account coa
      ON coa.bank_account_id = sa.id;

    RETURN _result;
END
$function$;
