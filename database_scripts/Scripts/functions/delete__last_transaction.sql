CREATE OR REPLACE FUNCTION prod.delete__last_transaction(_user_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 volatile 
AS $function$

-- удаляет одну или несколько последних записей (если у нескольких строк одна максимальная дата) 

begin
	
set search_path to 'prod';

delete from transactions 
where user_id = _user_id 
	  and "date" = get__last_date_transactions(_user_id);


return 'ok';

	
end
$function$
;
