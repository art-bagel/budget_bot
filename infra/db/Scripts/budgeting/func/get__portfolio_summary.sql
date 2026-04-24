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
          AND (
                (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
                OR
                (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
              )
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
    contributions_by_account AS (
        SELECT
            ce.bank_account_id,
            COALESCE(sum(
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
                END
            ), 0) AS net_contributed_in_base
        FROM contribution_entries ce
        GROUP BY ce.bank_account_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'investment_account_id', sa.id,
                'investment_account_name', sa.name,
                'investment_account_owner_type', sa.owner_type,
                'investment_account_owner_name', sa.owner_name,
                'cash_balance_in_base', COALESCE(ca.cash_balance_in_base, 0),
                'invested_principal_in_base', COALESCE(pa.invested_principal_in_base, 0),
                'realized_income_in_base', COALESCE(ia.realized_income_in_base, 0),
                'net_contributed_in_base', COALESCE(coa.net_contributed_in_base, 0),
                'open_positions_count', COALESCE(pa.open_positions_count, 0)
            )
            ORDER BY sa.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM scoped_accounts sa
    LEFT JOIN cash_by_account ca
      ON ca.bank_account_id = sa.id
    LEFT JOIN principal_by_account pa
      ON pa.investment_account_id = sa.id
    LEFT JOIN income_by_account ia
      ON ia.investment_account_id = sa.id
    LEFT JOIN contributions_by_account coa
      ON coa.bank_account_id = sa.id;

    RETURN _result;
END
$function$;
