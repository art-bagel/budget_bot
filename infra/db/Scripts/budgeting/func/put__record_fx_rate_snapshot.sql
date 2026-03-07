-- Description:
--   Stores a market FX rate snapshot for later valuation.
-- Parameters:
--   _base_currency_code char(3) - Target valuation currency.
--   _quote_currency_code char(3) - Currency being converted into the base currency.
--   _rate numeric - Amount of base currency for one unit of quote currency.
--   _fetched_at timestamptz - Snapshot time.
--   _source text - Optional source label.
-- Returns:
--   bigint - Identifier of the stored snapshot.
CREATE OR REPLACE FUNCTION budgeting.put__record_fx_rate_snapshot(
    _base_currency_code char(3),
    _quote_currency_code char(3),
    _rate numeric,
    _fetched_at timestamptz DEFAULT current_timestamp,
    _source text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _snapshot_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _base_currency_code = _quote_currency_code THEN
        RAISE EXCEPTION 'FX rate pair must contain two different currencies';
    END IF;

    IF _rate <= 0 THEN
        RAISE EXCEPTION 'FX rate must be positive';
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _base_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown base currency: %', _base_currency_code;
    END IF;

    PERFORM 1
    FROM currencies
    WHERE code = _quote_currency_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quote currency: %', _quote_currency_code;
    END IF;

    INSERT INTO fx_rate_snapshots (base_currency_code, quote_currency_code, rate, fetched_at, source)
    VALUES (_base_currency_code, _quote_currency_code, _rate, _fetched_at, _source)
    RETURNING id
    INTO _snapshot_id;

    RETURN _snapshot_id;
END
$function$;
