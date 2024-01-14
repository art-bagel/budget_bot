CREATE OR REPLACE FUNCTION prod.create__recursive_transaction(_user_id bigint, _from_category_id bigint, _to_category_id bigint, _amount numeric, _description text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

-- проходится по категориям в группе распределяя доход по группе категорий
-- если в группу вложены другие группы проходит их рекурсивно

declare cat RECORD;

BEGIN
	
SET search_path TO 'prod';
	
FOR cat IN (
			select c.id as category_id, cg.group_id, c.name, cg."percent", c.is_group 
			from categories c 
				 left join category_groups cg on cg.category_id = c.id
			where c.is_income = false 
				  and c.is_activ 
				  and cg.group_id = _to_category_id
				  and c.user_id = _user_id
			)
loop
	if cat.is_group 
	then 
	   	-- perform create__transaction(_user_id, _from_category_id,  cat."percent" * _amount, cat.category_id, _description);
   		-- perform create__recursive_transaction(_user_id, cat.category_id, cat.category_id, cat."percent" * _amount, _description);
   		perform create__recursive_transaction(_user_id, _from_category_id, cat.category_id, cat."percent" * _amount, _description);
   		
   	else 
   		perform create__transaction(_user_id, _from_category_id,  cat."percent" * _amount, cat.category_id, _description);
	   	end if;
	   		
END LOOP;
  
return 'ok';

END 
$function$
;
