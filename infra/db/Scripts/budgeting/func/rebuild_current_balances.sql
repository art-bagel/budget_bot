CREATE OR REPLACE FUNCTION budgeting.rebuild_current_balances(
    _user_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    IF _user_id IS NULL THEN
        TRUNCATE TABLE current_bank_balances;
        TRUNCATE TABLE current_budget_balances;
    ELSE
        DELETE FROM current_bank_balances cbb
        USING bank_accounts ba
        WHERE ba.id = cbb.bank_account_id
          AND ba.user_id = _user_id;

        DELETE FROM current_budget_balances cbb
        USING categories c
        WHERE c.id = cbb.category_id
          AND c.user_id = _user_id;
    END IF;

    INSERT INTO current_budget_balances (
        category_id,
        currency_code,
        amount,
        updated_at
    )
    SELECT
        be.category_id,
        be.currency_code,
        sum(be.amount) AS amount,
        current_timestamp
    FROM budget_entries be
    JOIN categories c
      ON c.id = be.category_id
    WHERE _user_id IS NULL OR c.user_id = _user_id
    GROUP BY be.category_id, be.currency_code
    HAVING sum(be.amount) <> 0;

    WITH bank_amounts AS (
        SELECT
            be.bank_account_id,
            be.currency_code,
            sum(be.amount) AS amount
        FROM bank_entries be
        JOIN bank_accounts ba
          ON ba.id = be.bank_account_id
        WHERE _user_id IS NULL OR ba.user_id = _user_id
        GROUP BY be.bank_account_id, be.currency_code
    ),
    lot_costs AS (
        SELECT
            fl.bank_account_id,
            fl.currency_code,
            sum(fl.cost_base_remaining) AS historical_cost_in_base
        FROM fx_lots fl
        JOIN bank_accounts ba
          ON ba.id = fl.bank_account_id
        WHERE fl.amount_remaining > 0
          AND (_user_id IS NULL OR ba.user_id = _user_id)
        GROUP BY fl.bank_account_id, fl.currency_code
    )
    INSERT INTO current_bank_balances (
        bank_account_id,
        currency_code,
        amount,
        historical_cost_in_base,
        updated_at
    )
    SELECT
        ba.id,
        a.currency_code,
        a.amount,
        CASE
            WHEN a.currency_code = u.base_currency_code THEN round(a.amount, 2)
            ELSE COALESCE(lc.historical_cost_in_base, 0)
        END AS historical_cost_in_base,
        current_timestamp
    FROM bank_amounts a
    JOIN bank_accounts ba
      ON ba.id = a.bank_account_id
    JOIN users u
      ON u.id = ba.user_id
    LEFT JOIN lot_costs lc
      ON lc.bank_account_id = a.bank_account_id
     AND lc.currency_code = a.currency_code
    WHERE a.amount <> 0
       OR COALESCE(lc.historical_cost_in_base, 0) <> 0;
END
$function$;
