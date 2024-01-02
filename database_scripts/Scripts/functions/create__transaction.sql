
-- создает одиночную запись для перемешения суммы из одной категории в другую

CREATE OR REPLACE FUNCTION prod.create__transaction(_user_id bigint, _id_category_from bigint, _amount numeric, _id_category_to bigint DEFAULT NULL::bigint, _description text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

declare _date_transaction timestamp := current_timestamp;

begin

insert into transactions (user_id, category_from, category_to, date, amount, description)
values(_user_id, _id_category_from, _id_category_to, _date_transaction, _amount, _description);


return 'ok';

	
end
$function$
;
