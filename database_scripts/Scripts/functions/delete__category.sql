CREATE OR REPLACE FUNCTION prod.delete__category(_id_category bigint, _user_id bigint, _id_category_reciver bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

-- удаляет категорию, необходимо передать в параметре категорию, в которую перейдет остаток
--

declare _delete_category_amount numeric;

begin

SET search_path to 'prod';

IF not (select is_owner from category_user where user_id = _user_id and category_id = _id_category)
THEN
   RAISE EXCEPTION 'Только владелец категории может ее удалить';
end if;


IF (select group_id from category_groups where category_id = _id_category ) is not null
THEN
   RAISE EXCEPTION 'Нельзя удалить категорию, которая находится в группе. Сперва исключите категорию из группы';
END IF;

select sum(amount) into _delete_category_amount
from (
	select amount from transactions t where category_to = _id_category
	union all
	select -amount from transactions t where category_from = _id_category
) sub;


IF _id_category_reciver is null and _delete_category_amount > 0
THEN
   RAISE EXCEPTION 'Нельзя удалить категорию, у которой баланс больше нуля';
END IF;

-- переводим баланс если указан id категории приемника
IF _id_category_reciver is not null
THEN
   perform create__transaction(_user_id, _id_category, _delete_category_amount, _id_category_reciver, 'Перемещение между категориями');
END IF;


update categories c
		set is_activ = false,
			date_to = current_timestamp
from category_user cu
where cu.category_id = _id_category
	  and cu.user_id = _user_id
	  and c.id = cu.category_id;

return 'ok';


end
$function$
;

