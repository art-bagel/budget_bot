-- The history row of an operation (or journal event without one) as the live
-- history renders it now, plus its filter membership: the cancelled row keeps
-- showing on exactly the same pages after the rollback.
-- ponytail: 21 history calls per cancel; fine at personal-ledger sizes.
DROP FUNCTION IF EXISTS budgeting.get__cancel_snapshot;
CREATE FUNCTION budgeting.get__cancel_snapshot(_user_id bigint, _operation_id bigint, _source_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $f$
BEGIN
 RETURN (WITH one AS (
  SELECT t, a, budgeting.get__operations_history(_user_id, 1, 0, t, a,
    CASE WHEN _operation_id IS NOT NULL THEN ARRAY[_operation_id] END,
    CASE WHEN _operation_id IS NULL THEN ARRAY[_source_event_id] END)->'items'->0 AS item
  FROM unnest(ARRAY[NULL, 'investment', 'banking']) t,
       unnest(ARRAY[NULL, 'security', 'deposit', 'crypto', 'other', 'collectible', 'currency']) a
  WHERE t IS NULL OR a IS NULL)
 SELECT jsonb_build_object(
  'item', (SELECT item FROM one WHERE t IS NULL AND a IS NULL),
  'is_investment', EXISTS(SELECT 1 FROM one WHERE t = 'investment' AND item IS NOT NULL),
  'is_banking', EXISTS(SELECT 1 FROM one WHERE t = 'banking' AND item IS NOT NULL),
  'asset_types', COALESCE((SELECT jsonb_agg(a ORDER BY a) FROM one WHERE t IS NULL AND a IS NOT NULL AND item IS NOT NULL), '[]'::jsonb)));
END $f$;
