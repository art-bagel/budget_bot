DROP FUNCTION IF EXISTS budgeting.get__annuity_payment;
CREATE FUNCTION budgeting.get__annuity_payment(
    _principal numeric,
    _annual_rate numeric,
    _months integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    _monthly_rate numeric;
BEGIN
    IF _principal IS NULL OR _principal <= 0 OR _months IS NULL OR _months <= 0 THEN
        RETURN NULL;
    END IF;

    IF COALESCE(_annual_rate, 0) <= 0 THEN
        RETURN round(_principal / _months, 2);
    END IF;

    _monthly_rate := _annual_rate / 1200.0;
    RETURN round(
        _principal * _monthly_rate / (1 - power(1 + _monthly_rate, -_months)),
        2
    );
END
$function$;
