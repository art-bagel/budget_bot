DO $$
DECLARE
    _constraint_name text;
BEGIN
    SELECT conname
    INTO _constraint_name
    FROM pg_constraint
    WHERE conrelid = 'budgeting.portfolio_positions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%amount_in_currency >%'
      AND pg_get_constraintdef(oid) NOT LIKE '%asset_type_code%'
    LIMIT 1;

    IF _constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE budgeting.portfolio_positions DROP CONSTRAINT %I', _constraint_name);
    END IF;
END
$$;

ALTER TABLE budgeting.portfolio_positions
    DROP CONSTRAINT IF EXISTS chk_portfolio_positions_amount;

ALTER TABLE budgeting.portfolio_positions
    ADD CONSTRAINT chk_portfolio_positions_amount CHECK (
        (asset_type_code = 'crypto' AND amount_in_currency >= 0)
        OR
        (asset_type_code <> 'crypto' AND amount_in_currency > 0)
    );

UPDATE budgeting.portfolio_positions
SET amount_in_currency = 0,
    metadata = metadata
        - 'amount_in_base'
        - 'current_value_in_base'
        - 'valuation_updated_at'
        - 'valuation_comment'
        - 'realized_result_in_base'
        - 'last_realized_result_in_base'
        - 'close_value_in_base'
WHERE asset_type_code = 'crypto';

UPDATE budgeting.portfolio_events pe
SET amount = NULL,
    currency_code = NULL,
    metadata = pe.metadata
        - 'amount_in_base'
        - 'current_value_in_base'
        - 'valuation_updated_at'
        - 'valuation_comment'
        - 'principal_amount_in_base'
        - 'realized_result_in_base'
        - 'cost_basis_in_base'
FROM budgeting.portfolio_positions pp
WHERE pp.id = pe.position_id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type IN ('open', 'top_up', 'income', 'adjustment');

UPDATE budgeting.portfolio_events pe
SET metadata = pe.metadata
    - 'principal_amount_in_base'
    - 'realized_result_in_base'
FROM budgeting.portfolio_positions pp
WHERE pp.id = pe.position_id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type IN ('close', 'partial_close');

UPDATE budgeting.crypto_protocol_positions
SET cost_basis_in_base = 0,
    current_value_in_base = 0
WHERE cost_basis_in_base <> 0
   OR current_value_in_base <> 0;
