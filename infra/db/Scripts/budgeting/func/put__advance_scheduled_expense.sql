-- Advances next_run_at to the next period after a run (successful or failed).
-- Called by the background scheduler so that the same record is not re-triggered every minute.
CREATE OR REPLACE FUNCTION budgeting.put__advance_scheduled_expense(
    _schedule_id bigint
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
        -- Keep the same day_of_month in the next calendar month
        _new_next_run := (
            date_trunc('month', _current_next_run + INTERVAL '1 month')
            + (_day_of_month - 1) * INTERVAL '1 day'
        )::date;
    END IF;

    UPDATE scheduled_expenses
    SET next_run_at = _new_next_run,
        last_run_at = CURRENT_DATE
    WHERE id = _schedule_id;

    RETURN _new_next_run;
END
$function$;
