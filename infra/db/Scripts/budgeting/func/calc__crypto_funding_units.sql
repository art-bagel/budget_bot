-- Internal exact vector arithmetic. Values are units of each identified loan.
DROP FUNCTION IF EXISTS budgeting.calc__crypto_funding_units;
CREATE FUNCTION budgeting.calc__crypto_funding_units(_base jsonb, _delta jsonb, _factor numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE _r jsonb:=COALESCE(_base,'{}'); _k text; _v text; _n numeric;
BEGIN
    IF _factor IS NULL OR _factor::text IN ('NaN','Infinity','-Infinity')
        OR jsonb_typeof(COALESCE(_base,'{}'))<>'object' OR jsonb_typeof(COALESCE(_delta,'{}'))<>'object' THEN
        RAISE EXCEPTION 'Invalid financing vector';
    END IF;
    FOR _k,_v IN SELECT key,value FROM jsonb_each_text(COALESCE(_delta,'{}')) LOOP
        IF _v IS NULL OR _v::numeric<0 OR _v::numeric::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Invalid financing units';
        END IF;
        _n:=COALESCE((_r->>_k)::numeric,0)+round(_v::numeric*_factor,18);
        IF _n<0 THEN RAISE EXCEPTION 'Negative financing component'; END IF;
        IF _n=0 THEN _r:=_r-_k; ELSE _r:=jsonb_set(_r,ARRAY[_k],to_jsonb(_n)); END IF;
    END LOOP;
    RETURN _r;
END
$f$;
