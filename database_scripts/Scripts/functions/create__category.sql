CREATE OR REPLACE FUNCTION prod.create__category(_category_name text, _user_id bigint, _is_income boolean, _is_group boolean default false)
 RETURNS text
 LANGUAGE plpgsql
 volatile 
AS $function$

declare _category_id int8;

begin

SET search_path to 'prod';
	
-- вcтавляем новые категории 
insert into categories(name, is_income, date_from, date_to, is_activ, is_group)
VALUES(_category_name, _is_income, current_timestamp, '9999-12-31'::timestamp, true, _is_group)
returning id into _category_id;

-- добавляе связь пользователя и категории
insert into category_user (category_id, user_id, is_owner)
values (_category_id, _user_id, true);

return 'ok';

	
end
$function$
;
