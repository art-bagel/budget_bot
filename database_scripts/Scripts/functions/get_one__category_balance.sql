-- возвращает остаток по одной категории.

CREATE OR REPLACE FUNCTION prod.get_one__category_balance(_user_id bigint, _category_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$

declare result_balance numeric;


begin
	
SET search_path to 'prod';

-- получаем пополнния и расходы по категории
with cte as (

		select c.id as id_category, t.amount  
		from transactions t
			 join categories c on c.id = t.category_to 
		where c.user_id = _user_id and c.id = _category_id
		
		union all 

		select c.id as id_category, -t.amount  
		from transactions t
			 join categories c on c.id = t.category_from
		where c.user_id = _user_id and c.id = _category_id
-- группируем и получаем остаток по категории 
)
	select  sum(amount) into result_balance
	from cte 
	group by id_category;


return coalesce(result_balance, 0);

	
end
$function$
;