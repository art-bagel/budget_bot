DROP FUNCTION IF EXISTS budgeting.check__crypto_lending_state;
CREATE FUNCTION budgeting.check__crypto_lending_state(_metadata jsonb)
RETURNS void LANGUAGE plpgsql AS $function$
DECLARE
    _debt numeric := (_metadata->>'borrowed_quantity')::numeric;
    _interest numeric := COALESCE((_metadata->>'debt_interest_quantity')::numeric,0);
    _basis numeric := (_metadata->>'debt_cost_basis_in_base')::numeric;
    _interest_basis numeric := CASE WHEN _interest=0 THEN 0 ELSE (_metadata->>'debt_interest_basis_in_base')::numeric END;
BEGIN
    IF _metadata->>'debt_accounting_version' IS DISTINCT FROM '2'
        OR NOT (_metadata ? 'debt_cost_basis_in_base')
        OR _debt IS NULL OR _debt<0 OR _interest<0 OR _interest>_debt
        OR _debt::text IN ('NaN','Infinity','-Infinity')
        OR _interest::text IN ('NaN','Infinity','-Infinity')
        OR _basis<0 OR _interest_basis<0
        OR _basis::text IN ('NaN','Infinity','-Infinity')
        OR _interest_basis::text IN ('NaN','Infinity','-Infinity')
        OR _interest_basis>_basis
        OR (_basis IS NOT NULL AND _interest>0 AND _interest_basis IS NULL) THEN
        RAISE EXCEPTION 'Invalid or legacy lending state; reconstruct source events';
    END IF;
END
$function$;
