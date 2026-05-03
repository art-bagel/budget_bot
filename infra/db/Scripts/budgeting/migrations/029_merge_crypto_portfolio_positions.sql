CREATE SCHEMA IF NOT EXISTS budgeting;

WITH open_crypto AS (
    SELECT
        pp.id,
        pp.investment_account_id,
        (pp.metadata ->> 'crypto_asset_id')::bigint AS crypto_asset_id,
        COALESCE(pp.quantity, 0) AS quantity
    FROM budgeting.portfolio_positions pp
    WHERE pp.asset_type_code = 'crypto'
      AND pp.status = 'open'
      AND pp.metadata ->> 'crypto_asset_id' ~ '^[0-9]+$'
),
ranked AS (
    SELECT
        oc.*,
        MIN(oc.id) OVER (PARTITION BY oc.investment_account_id, oc.crypto_asset_id) AS keeper_id,
        COUNT(*) OVER (PARTITION BY oc.investment_account_id, oc.crypto_asset_id) AS group_size
    FROM open_crypto oc
),
duplicates AS (
    SELECT *
    FROM ranked
    WHERE group_size > 1
),
member_to_keeper AS (
    SELECT id AS member_id, keeper_id
    FROM duplicates
    WHERE id <> keeper_id
),
group_totals AS (
    SELECT
        keeper_id,
        SUM(quantity) AS total_quantity,
        jsonb_agg(id ORDER BY id) AS member_ids
    FROM duplicates
    GROUP BY keeper_id
),
updated_events AS (
    UPDATE budgeting.portfolio_events pe
    SET position_id = mtk.keeper_id
    FROM member_to_keeper mtk
    WHERE pe.position_id = mtk.member_id
    RETURNING pe.id
),
updated_protocol_sources AS (
    UPDATE budgeting.crypto_protocol_positions cpp
    SET metadata = jsonb_set(
        cpp.metadata,
        '{source_position_id}',
        to_jsonb(mtk.keeper_id),
        true
    )
    FROM member_to_keeper mtk
    WHERE cpp.metadata ->> 'source_position_id' ~ '^[0-9]+$'
      AND (cpp.metadata ->> 'source_position_id')::bigint = mtk.member_id
    RETURNING cpp.id
),
updated_protocol_returns AS (
    UPDATE budgeting.crypto_protocol_positions cpp
    SET metadata = jsonb_set(
        cpp.metadata,
        '{return_position_id}',
        to_jsonb(mtk.keeper_id),
        true
    )
    FROM member_to_keeper mtk
    WHERE cpp.metadata ->> 'return_position_id' ~ '^[0-9]+$'
      AND (cpp.metadata ->> 'return_position_id')::bigint = mtk.member_id
    RETURNING cpp.id
),
updated_keepers AS (
    UPDATE budgeting.portfolio_positions pp
    SET quantity = gt.total_quantity,
        amount_in_currency = 0,
        metadata = pp.metadata || jsonb_build_object('merged_crypto_position_ids', gt.member_ids)
    FROM group_totals gt
    WHERE pp.id = gt.keeper_id
    RETURNING pp.id
)
DELETE FROM budgeting.portfolio_positions pp
USING member_to_keeper mtk
WHERE pp.id = mtk.member_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_open_crypto_asset_per_account
    ON budgeting.portfolio_positions (
        investment_account_id,
        ((metadata ->> 'crypto_asset_id')::bigint)
    )
    WHERE asset_type_code = 'crypto'
      AND status = 'open'
      AND metadata ->> 'crypto_asset_id' ~ '^[0-9]+$';
