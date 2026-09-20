-- Description:
--   Записывает итог исполнения запланированного расхода в last_error.
--
--   Отделена от сдвига даты намеренно: сдвиг теперь происходит в момент
--   захвата (put__claim_due_scheduled_expenses), а сюда приходит уже
--   результат попытки. Прежняя put__advance_scheduled_expense делала оба
--   действия сразу, и повторный вызов сдвинул бы дату второй раз.
-- Parameters:
--   _schedule_id bigint - Идентификатор запланированного расхода.
--   _error text - Текст ошибки, либо NULL при успехе (тогда last_error чистится).
-- Returns:
--   boolean - Была ли найдена строка.
DROP FUNCTION IF EXISTS budgeting.set__scheduled_expense_run_result;
CREATE FUNCTION budgeting.set__scheduled_expense_run_result(
    _schedule_id bigint,
    _error       text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE scheduled_expenses
    SET last_error = _error
    WHERE id = _schedule_id;

    RETURN FOUND;
END
$function$;
