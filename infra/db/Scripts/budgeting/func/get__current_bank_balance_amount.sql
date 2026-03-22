CREATE OR REPLACE FUNCTION budgeting.get__current_bank_balance_amount(
    _bank_account_id bigint,
    _currency_code char(3)
)
RETURNS numeric
LANGUAGE sql
AS $function$
    SELECT COALESCE((
        SELECT amount
        FROM budgeting.current_bank_balances
        WHERE bank_account_id = _bank_account_id
          AND currency_code = upper(_currency_code)
    ), 0)
$function$;
