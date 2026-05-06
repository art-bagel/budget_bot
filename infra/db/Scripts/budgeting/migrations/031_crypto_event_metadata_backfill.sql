-- Backfill standardized metadata fields for legacy crypto portfolio_events.
-- Production state at migration time: at most one bank→portfolio transfer.
-- Best-effort; events that can't be reconstructed are left as-is and treated
-- as zero-cost-contribution by read-side (get__crypto_position_entry_summary).

CREATE SCHEMA IF NOT EXISTS budgeting;

-- 1. Entry events from bank: 'open' / 'top_up' linked to crypto_lot_consumptions.
--    Sum cost_base over consumptions for the same operation.
WITH bank_entry_costs AS (
    SELECT
        clc.operation_id,
        SUM(clc.cost_base) AS total_cost_base
    FROM budgeting.crypto_lot_consumptions clc
    GROUP BY clc.operation_id
)
UPDATE budgeting.portfolio_events pe
SET metadata = pe.metadata || jsonb_build_object(
    'entry_value_in_base', round(bec.total_cost_base, 2),
    'source_kind', 'bank'
)
FROM bank_entry_costs bec, budgeting.portfolio_positions pp
WHERE pe.linked_operation_id = bec.operation_id
  AND pe.position_id = pp.id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type IN ('open', 'top_up')
  AND NOT (pe.metadata ? 'entry_value_in_base');

-- 2. Exit events to bank: 'close' / 'partial_close' that already carry
--    'amount_in_base' in metadata (from put__transfer_crypto_from_investment).
--    Promote to standardized 'value_in_base' + 'target_kind'.
UPDATE budgeting.portfolio_events pe
SET metadata = pe.metadata || jsonb_build_object(
    'value_in_base', (pe.metadata ->> 'amount_in_base')::numeric,
    'target_kind', 'bank'
)
FROM budgeting.portfolio_positions pp
WHERE pe.position_id = pp.id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type IN ('close', 'partial_close')
  AND pe.metadata ? 'amount_in_base'
  AND NOT (pe.metadata ? 'value_in_base');

-- 3. Exit events to DeFi: 'adjustment' with action='stake_to_protocol'.
--    These were used by put__create_crypto_protocol_position before the rewrite.
--    They have no recorded value_in_base and pre-rewrite cost_basis_carried in
--    DeFi was forced to 0. Mark them as legacy so read-side ignores their
--    consumption side (already not summed because event_type='adjustment').
UPDATE budgeting.portfolio_events pe
SET metadata = pe.metadata || jsonb_build_object('legacy_no_basis', true)
FROM budgeting.portfolio_positions pp
WHERE pe.position_id = pp.id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type = 'adjustment'
  AND pe.metadata ->> 'action' = 'stake_to_protocol'
  AND NOT (pe.metadata ? 'legacy_no_basis');

-- 4. Entry events from DeFi return: 'open' / 'top_up' with action='return_from_protocol'
--    Mark as legacy if no entry_value_in_base set (carried cost was 0 in old code).
UPDATE budgeting.portfolio_events pe
SET metadata = pe.metadata || jsonb_build_object('legacy_no_basis', true, 'source_kind', 'defi_return')
FROM budgeting.portfolio_positions pp
WHERE pe.position_id = pp.id
  AND pp.asset_type_code = 'crypto'
  AND pe.event_type IN ('open', 'top_up')
  AND pe.metadata ->> 'action' = 'return_from_protocol'
  AND NOT (pe.metadata ? 'entry_value_in_base');
