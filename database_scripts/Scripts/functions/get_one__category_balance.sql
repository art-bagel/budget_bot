CREATE OR REPLACE FUNCTION prod.get_one__category_balance(_user_id bigint, _category_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$

-- возвращает остаток по одной категории.


declare result_balance numeric;


begin
	
SET search_path to 'prod';

-- получаем пополнния и расходы по категории
with cte as (

		select c.id as id_category, t.amount  
		from transactions t
			 join categories c on c.id = t.category_to
			 join category_user cu on cu.category_id = c.id
		where cu.category_id = _category_id and cu.user_id = _user_id
		
		union all 

		select c.id as id_category, -t.amount  
		from transactions t
			 join categories c on c.id = t.category_from
			 join category_user cu on cu.category_id = c.id
		where cu.category_id = _category_id and cu.user_id = _user_id
-- группируем и получаем остаток по категории 
)
	select  sum(amount) into result_balance
	from cte 
	group by id_category;


return coalesce(result_balance, 0);

	
end
$function$
;