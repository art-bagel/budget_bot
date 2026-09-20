-- Description:
--   Атомарно забирает в работу все запланированные расходы, срок которых
--   наступил, и сразу сдвигает их next_run_at на следующий период.
--
--   Захват и сдвиг — одна операция, и это главное свойство функции. Раньше
--   scheduler сначала читал список (get__due_scheduled_expenses), потом
--   записывал расход, и только потом сдвигал дату отдельным вызовом. Между
--   этими шагами помещались два сценария двойного списания:
--     * два инстанса API читали один и тот же список и оба проводили расход;
--     * процесс падал после put__record_expense, но до сдвига даты — и на
--       следующем тике тот же расход проводился заново.
--
--   Теперь строка, попавшая в результат, уже сдвинута: получить её второй раз
--   нельзя. FOR UPDATE SKIP LOCKED разводит параллельные инстансы по
--   непересекающимся наборам строк.
--
--   Цена такого порядка — at-most-once вместо at-least-once: если процесс
--   умрёт между захватом и записью расхода, расход будет пропущен, а не
--   продублирован. Для денег это правильная сторона размена, а пропуск виден
--   в UI по last_run_at без последующей операции.
--
--   bank_account_id может быть NULL: основной счёт владельца может быть не
--   заведён или деактивирован. Раньше такая строка молча выпадала из выборки
--   по INNER JOIN и не сдвигалась вовсе — то есть висела просроченной вечно и
--   при этом нигде не отображалась. Теперь она захватывается как все
--   остальные, а вызывающий код записывает ей внятную ошибку.
-- Parameters:
--   Нет.
-- Returns:
--   jsonb - Массив захваченных расходов; bank_account_id может быть null.
DROP FUNCTION IF EXISTS budgeting.put__claim_due_scheduled_expenses;
CREATE FUNCTION budgeting.put__claim_due_scheduled_expenses()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    WITH due AS (
        SELECT id
        FROM scheduled_expenses
        WHERE is_active = TRUE
          AND next_run_at <= CURRENT_DATE
        ORDER BY id
        -- SKIP LOCKED: параллельный инстанс не ждёт нашу транзакцию, а просто
        -- берёт другие строки. Ждать было бы бессмысленно — после коммита
        -- строка всё равно перестанет подходить под условие.
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE scheduled_expenses se
        SET next_run_at = (
                CASE se.frequency
                    WHEN 'weekly' THEN se.next_run_at + INTERVAL '7 days'
                    -- Тот же день следующего месяца, но не дальше его последнего
                    -- дня: 31-е в феврале становится 28/29-м.
                    WHEN 'monthly' THEN
                        date_trunc('month', se.next_run_at + INTERVAL '1 month')
                        + (
                            LEAST(
                                se.day_of_month,
                                EXTRACT(
                                    DAY FROM date_trunc('month', se.next_run_at + INTERVAL '2 months')
                                             - INTERVAL '1 day'
                                )::int
                            ) - 1
                          ) * INTERVAL '1 day'
                END
            )::date,
            last_run_at = CURRENT_DATE
        FROM due
        WHERE se.id = due.id
        RETURNING
            se.id,
            se.category_id,
            se.created_by_user_id,
            se.amount,
            se.currency_code,
            se.comment,
            se.frequency,
            se.day_of_week,
            se.day_of_month,
            se.owner_type,
            se.owner_user_id,
            se.owner_family_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',                 c.id,
                'category_id',        c.category_id,
                'bank_account_id',    ba.id,
                'created_by_user_id', c.created_by_user_id,
                'amount',             c.amount,
                'currency_code',      c.currency_code,
                'comment',            c.comment,
                'frequency',          c.frequency,
                'day_of_week',        c.day_of_week,
                'day_of_month',       c.day_of_month
            )
            ORDER BY c.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM claimed c
    -- Основной наличный счёт того же владельца, что и категория: личная
    -- категория → личный счёт, семейная → семейный.
    LEFT JOIN bank_accounts ba
           ON ba.owner_type = c.owner_type
          AND (
                  (c.owner_type = 'user'   AND ba.owner_user_id   = c.owner_user_id)
               OR (c.owner_type = 'family' AND ba.owner_family_id = c.owner_family_id)
              )
          AND ba.is_primary    = TRUE
          AND ba.account_kind  = 'cash'
          AND ba.is_active     = TRUE;

    RETURN _result;
END
$function$;
