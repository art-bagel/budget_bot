CREATE OR REPLACE FUNCTION prod.get__categories_balance_json(_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$

-- возвращает остаток по всем активным категориям в формате json, котогые не отмечены как доход.

declare result_json jsonb;


begin
	
SET search_path to 'prod';

-- получаем пополнния и расходы по активным категориям
with cte as (

		select c.id as id_category, c.is_activ, c.is_income, c.name, coalesce(t.amount, 0) as amount
		from transactions t
			 right join categories c on c.id = t.category_to 
			 	   join category_user cu on cu.category_id = c.id
		where cu.user_id = _user_id 
			  and c.is_activ 
			  and c.is_income = false 
			  and c.is_group = false
		
		union all 

		select c.id as id_category, c.is_activ, c.is_income, c.name, coalesce(-t.amount, 0) as amount
		from transactions t
			 right join categories c on c.id = t.category_from
		 		   join category_user cu on cu.category_id = c.id
		where cu.user_id = _user_id 
			  and c.is_activ 
			  and c.is_income = false 
			  and c.is_group = false
-- группируем и получаем остаток по активным категориям
), balance as (
		select id_category, name, sum(amount) as balance
		from cte 
		group by id_category, name
)
select json_agg(json_build_object('id_category', id_category, 'name', name, 'balance', balance)) 
	   into result_json 
FROM balance;

return result_json;

	
end
$function$
;
