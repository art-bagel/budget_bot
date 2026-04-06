-- Advances next_run_at to the next period after a run (successful or failed).
-- _error: NULL on success, error message on failure — stored in last_error for display in UI.
-- Called by the background scheduler so that the same record is not re-triggered every minute.
DROP FUNCTION IF EXISTS budgeting.put__advance_scheduled_expense;
CREATE FUNCTION budgeting.put__advance_scheduled_expense(
    _schedule_id bigint,
    _error       text DEFAULT NULL
)
RETURNS date
LANGUAGE plpgsql
AS $function$
DECLARE
    _frequency        text;
    _day_of_week      smallint;
    _day_of_month     smallint;
    _current_next_run date;
    _new_next_run     date;
BEGIN
    SET search_path TO budgeting;

    SELECT frequency, day_of_week, day_of_month, next_run_at
    INTO _frequency, _day_of_week, _day_of_month, _current_next_run
    FROM scheduled_expenses
    WHERE id = _schedule_id;

    IF _frequency IS NULL THEN
        RAISE EXCEPTION 'Scheduled expense % not found', _schedule_id;
    END IF;

    IF _frequency = 'weekly' THEN
        _new_next_run := _current_next_run + INTERVAL '7 days';
    ELSIF _frequency = 'monthly' THEN
        -- Advance to the same day_of_month in the next calendar month.
        -- Clamp to the actual last day of that month so "31st" in February becomes 28/29.
        DECLARE
            _last_day_next int;
        BEGIN
            _last_day_next := EXTRACT(DAY FROM
                date_trunc('month', _current_next_run + INTERVAL '2 months') - INTERVAL '1 day'
            )::int;
            _new_next_run := (
                date_trunc('month', _current_next_run + INTERVAL '1 month')
                + (LEAST(_day_of_month, _last_day_next) - 1) * INTERVAL '1 day'
            )::date;
        END;
    END IF;

    UPDATE scheduled_expenses
    SET next_run_at = _new_next_run,
        last_run_at = CURRENT_DATE,
        last_error  = _error
    WHERE id = _schedule_id;

    RETURN _new_next_run;
END
$function$;
