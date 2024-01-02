
-- удаляет одну или несколько записей (если у нескольких строк одна максимальная дата)

CREATE OR REPLACE FUNCTION prod.delete__last_transaction(_user_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$


begin

delete from transactions where user_id = _user_id and "date" = get_last_date_transactions(_user_id);


return 'ok';

	
end
$function$
;
