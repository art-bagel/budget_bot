CREATE OR REPLACE FUNCTION prod.change__balance_between_categories(_user_id bigint, _id_category_from bigint, _id_category_to bigint, _description text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 volatile 
AS $function$

-- перемещает остаток из одной категории в другую

declare _date_transaction timestamp := current_timestamp;
		_amount_balance NUMERIC;

begin
	
set search_path to 'prod';

_amount_balance := (SELECT get_one__category_balance(_user_id, _id_category_from));

IF _amount_balance < 0
THEN
	RAISE EXCEPTION 'Нельзя перенести отрицательный баланс';
end if;

perform create__transaction(_user_id, _id_category_from, _amount_balance, _id_category_to, _description);


return 'ok';

	
end
$function$
;
