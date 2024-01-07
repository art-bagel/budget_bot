CREATE OR REPLACE FUNCTION prod.get__last_transaction(_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 volatile 
AS $function$

-- возвращает одну или несколько транзакций за максимальную дату

declare result_json jsonb;

BEGIN
	
SET search_path TO 'prod';

with cte as (
	select c.name as name_from, c2.name as name_to, t.amount 
	from transactions t 
		 left join categories c on t.category_from = c.id 
		 left join categories c2 on t.category_to = c2.id
	where t.user_id = _user_id and  date = get__last_date_transactions(_user_id)
)
select json_agg(json_build_object('name_from', name_from, 'name_to', name_to, 'amount', amount)) 
	   into result_json 
FROM cte;


return  result_json;

	
end
$function$
;
