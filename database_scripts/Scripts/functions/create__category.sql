CREATE OR REPLACE FUNCTION prod.create__category(_category_name text, _user_id bigint, _is_income boolean, _is_group boolean default false)
 RETURNS text
 LANGUAGE plpgsql
 volatile 
AS $function$


begin

SET search_path to 'prod';
	
-- вcтавляем новые категории 
insert into categories(name, user_id, is_income, date_from, date_to, is_activ, is_group)
VALUES(_category_name, _user_id, _is_income, current_timestamp, '9999-12-31'::timestamp, true, _is_group);

return 'ok';

	
end
$function$
;
