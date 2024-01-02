
-- возвращает остаток по всем активным категориям в формате json, котогые не отмечены как доход.

CREATE OR REPLACE FUNCTION prod.get__categoryes_balance_json(_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$

declare result_json jsonb;


begin

-- получаем пополнния и расходы по активным категориям
with cte as (

		select c.id as id_category, c.id_group, c.is_activ, c.is_income, c.name, t.amount  
		from transactions t
			 join categories c on c.id = t.category_to 
		where c.user_id = _user_id and c.is_activ and is_income = false
		
		union all 

		select c.id as id_category, c.id_group, c.is_activ, c.is_income, c.name, -t.amount  
		from transactions t
			 join categories c on c.id = t.category_from
		where c.user_id = _user_id and c.is_activ and is_income = false
-- группируем и получаем остаток по активным категориям
), balance as (
		select id_category, id_group, name, sum(amount) as balance
		from cte 
		group by id_category, id_group, name
)
select json_agg(json_build_object('id_category', id_category, 'id_group', id_group, 'name', name, 'balance', balance)) 
	   into result_json 
FROM balance;

return result_json;

	
end
$function$
;
