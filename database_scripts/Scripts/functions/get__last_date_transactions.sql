
-- возвращает дату последней строки или группы строк

CREATE OR REPLACE FUNCTION prod.get__last_date_transactions(_user_id bigint)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
AS $function$


declare last_spend_date_transaction timestamp;

begin

-- получаем группу последней операции
return  (select  max("date")  from transactions where user_id = _user_id);

	
end
$function$
;
