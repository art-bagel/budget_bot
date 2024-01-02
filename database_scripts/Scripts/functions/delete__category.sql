
-- удаляет категорию, необходимо передать в параметре категорию, в которую перейдет остаток

CREATE OR REPLACE FUNCTION prod.delete__category(_id_category bigint, _id_recipient_category bigint, _user_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

declare delete_category_amount numeric;

begin
	
-- проеряем что сумма процентов по группе равняется 100%
IF (select id_group from categories where user_id = _user_id and id = _id_category ) != null THEN
   RAISE EXCEPTION 'Нельзя удалить категорию, которая находится в группе. Сперва исключите категорию из группы';
END IF;

delete_category_amount = (select sum(amount) from (
							select amount from transactions t where category_to = _id_category
							union all 
							select -amount from transactions t where category_from = _id_category
						) sub);
					
perform create__transaction(_user_id, _id_category, delete_category_amount, _id_recipient_category, 'Перемещение между категориями');

update categories 
		set is_activ = false,
			date_to = current_timestamp
where user_id = _user_id
	  and id = _id_category;

return 'ok';

	
end
$function$
;
