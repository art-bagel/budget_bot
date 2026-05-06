DROP FUNCTION IF EXISTS budgeting.get__crypto_position_entry_summary;
CREATE FUNCTION budgeting.get__crypto_position_entry_summary(
    _position_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _total_entry numeric(20, 2) := 0;
    _total_consumed numeric(20, 2) := 0;
    _qty_now numeric(30, 12) := 0;
    _remaining_cost numeric(20, 2);
    _avg_cost numeric(30, 12);
BEGIN
    SET search_path TO budgeting;

    -- Sum entry values from all entry-type events that carry standardized metadata.
    -- Legacy events without 'entry_value_in_base' are silently ignored — read-side
    -- treats them as zero-cost contribution.
    SELECT COALESCE(SUM((metadata ->> 'entry_value_in_base')::numeric), 0)
    INTO _total_entry
    FROM portfolio_events
    WHERE position_id = _position_id
      AND event_type IN ('open', 'top_up', 'transfer_in', 'swap_in', 'income')
      AND metadata ? 'entry_value_in_base';

    -- Sum cost basis already consumed by exit events.
    SELECT COALESCE(SUM((metadata ->> 'consumed_cost_basis')::numeric), 0)
    INTO _total_consumed
    FROM portfolio_events
    WHERE position_id = _position_id
      AND event_type IN ('close', 'partial_close', 'transfer_out', 'swap_out')
      AND metadata ? 'consumed_cost_basis';

    SELECT COALESCE(quantity, 0)
    INTO _qty_now
    FROM portfolio_positions
    WHERE id = _position_id;

    _remaining_cost := GREATEST(_total_entry - _total_consumed, 0);
    _avg_cost := CASE WHEN _qty_now > 0 THEN _remaining_cost / _qty_now ELSE 0 END;

    RETURN jsonb_build_object(
        'total_entry_value_in_base', _total_entry,
        'total_consumed_cost_basis', _total_consumed,
        'remaining_cost_basis', _remaining_cost,
        'quantity_now', _qty_now,
        'avg_cost_per_unit', _avg_cost
    );
END
$function$;
