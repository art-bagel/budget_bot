CREATE OR REPLACE FUNCTION prod.get__last_date_transactions(_user_id bigint)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
 volatile 
AS $function$

-- возвращает дату последней строки или группы строк

declare last_spend_date_transaction timestamp;

BEGIN
	
SET search_path TO 'prod';

-- получаем группу последней операции
return  (select  max("date")  from transactions where user_id = _user_id);

	
end
$function$
;
