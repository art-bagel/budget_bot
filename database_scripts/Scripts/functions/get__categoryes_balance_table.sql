
-- возвращает остаток по всем активным категориям в формате таблицы, которые не отмечены как доход.

CREATE OR REPLACE FUNCTION prod.get__categoryes_balance_table(_user_id bigint)
 RETURNS TABLE(category bigint, category_group bigint, category_name text, balance numeric)
 LANGUAGE plpgsql
AS $function$


begin

return query
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
		)
		select cte.id_category::int8 as category, cte.id_group::int8 as category_group, cte.name::text as category_name, sum(amount)::numeric as balance
		from cte 
		group by id_category, id_group, name;

	
end
$function$
;
