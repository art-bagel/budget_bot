DROP FUNCTION IF EXISTS budgeting.set__update_deposit_after_accrual;
CREATE FUNCTION budgeting.set__update_deposit_after_accrual(
    _position_id bigint,
    _interest_amount numeric,
    _last_accrual_date date
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    UPDATE portfolio_positions
    SET amount_in_currency = amount_in_currency + _interest_amount,
        metadata = jsonb_set(
            jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{last_accrual_date}',
                to_jsonb(_last_accrual_date::text),
                true
            ),
            '{amount_in_base}',
            to_jsonb(
                round(
                    COALESCE((metadata ->> 'amount_in_base')::numeric, amount_in_currency) + _interest_amount,
                    2
                )
            ),
            true
        )
    WHERE id = _position_id;
END
$function$;
