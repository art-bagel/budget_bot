-- Backfill budget ledger for historical Tinkoff broker deposits imported as
-- cash -> investment transfers before put__record_broker_transfer_in started
-- writing the source Unallocated budget entry.
WITH candidates AS (
    SELECT
        o.id AS operation_id,
        budgeting.get__owner_system_category_id(
            src_acc.owner_type,
            src_acc.owner_user_id,
            src_acc.owner_family_id,
            'Unallocated'
        ) AS category_id,
        budgeting.get__owner_base_currency(
            src_acc.owner_type,
            src_acc.owner_user_id,
            src_acc.owner_family_id
        ) AS base_currency_code,
        CASE
            WHEN src.currency_code = budgeting.get__owner_base_currency(
                src_acc.owner_type,
                src_acc.owner_user_id,
                src_acc.owner_family_id
            )
                THEN round(abs(src.amount), 2)
            ELSE COALESCE(
                (
                    SELECT round(sum(lc.cost_base), 2)
                    FROM budgeting.lot_consumptions lc
                    WHERE lc.operation_id = o.id
                ),
                round(abs(src.amount), 2)
            )
        END AS amount_in_base
    FROM budgeting.operations o
    JOIN budgeting.bank_entries inv
      ON inv.operation_id = o.id
     AND inv.import_source = 'tinkoff'
     AND inv.external_id IS NOT NULL
     AND inv.amount > 0
    JOIN budgeting.bank_accounts inv_acc
      ON inv_acc.id = inv.bank_account_id
     AND inv_acc.account_kind = 'investment'
    JOIN budgeting.bank_entries src
      ON src.operation_id = o.id
     AND src.id <> inv.id
     AND src.amount < 0
    JOIN budgeting.bank_accounts src_acc
      ON src_acc.id = src.bank_account_id
     AND src_acc.account_kind = 'cash'
    WHERE o.type = 'account_transfer'
      AND o.comment = 'Tinkoff: перевод на брокерский счёт'
      AND NOT EXISTS (
          SELECT 1
          FROM budgeting.budget_entries bue
          WHERE bue.operation_id = o.id
      )
),
inserted AS (
    INSERT INTO budgeting.budget_entries (
        operation_id,
        category_id,
        currency_code,
        amount
    )
    SELECT
        operation_id,
        category_id,
        base_currency_code,
        -amount_in_base
    FROM candidates
    WHERE category_id IS NOT NULL
      AND amount_in_base > 0
    RETURNING category_id, currency_code, amount
)
INSERT INTO budgeting.current_budget_balances (
    category_id,
    currency_code,
    amount
)
SELECT
    category_id,
    currency_code,
    sum(amount)
FROM inserted
GROUP BY category_id, currency_code
ON CONFLICT (category_id, currency_code)
DO UPDATE SET
    amount = budgeting.current_budget_balances.amount + EXCLUDED.amount,
    updated_at = now();
