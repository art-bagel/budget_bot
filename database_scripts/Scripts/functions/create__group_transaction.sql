
-- создает несколько записей, из одной категории разбивает сумму на несколько категорий в группе. 
-- деление суммы происходит по полю процента в группе 

CREATE OR REPLACE FUNCTION prod.create__group_transaction(_user_id bigint, _id_category_from bigint, _id_group_to bigint, _amount numeric, _description text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

declare _date_transaction timestamp := current_timestamp;

begin

-- добавляем транзакцию из категории разбитую на группу категорий
insert into transactions(user_id, category_from, category_to, "date", amount, description)
select _user_id,
	   f.id,
 	   t.id,
 	   _date_transaction,
	   (_amount * t."percent")::numeric(10,2),
	   _description
from categories t, categories f
where t.id_group = _id_group_to
	  and t.user_id = _user_id
	  and f.user_id = _user_id
	  and f.id = _id_category_from;


return 'ok';

	
end
$function$
;
