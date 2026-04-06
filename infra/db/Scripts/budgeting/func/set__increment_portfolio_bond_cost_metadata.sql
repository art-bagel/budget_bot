DROP FUNCTION IF EXISTS budgeting.set__increment_portfolio_bond_cost_metadata;
CREATE FUNCTION budgeting.set__increment_portfolio_bond_cost_metadata(
    _position_id bigint,
    _clean_amount_delta numeric,
    _accrued_interest_delta numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    _effective_clean_delta numeric(20, 2);
    _effective_accrued_delta numeric(20, 2);
BEGIN
    SET search_path TO budgeting;

    _effective_clean_delta := round(COALESCE(_clean_amount_delta, 0), 2);
    _effective_accrued_delta := round(COALESCE(_accrued_interest_delta, 0), 2);

    IF _effective_clean_delta <= 0 AND _effective_accrued_delta <= 0 THEN
        RETURN;
    END IF;

    UPDATE portfolio_positions
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'clean_amount_in_base',
        COALESCE((metadata ->> 'clean_amount_in_base')::numeric, 0) + _effective_clean_delta,
        'accrued_interest_paid_in_base',
        COALESCE((metadata ->> 'accrued_interest_paid_in_base')::numeric, 0) + _effective_accrued_delta
    )
    WHERE id = _position_id;
END
$function$;
