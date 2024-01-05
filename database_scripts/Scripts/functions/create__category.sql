
-- создает категорию с пустой группой и 1(100%) в поле процент

CREATE OR REPLACE FUNCTION prod.create__category(_category_name text, _user_id bigint, _is_income boolean)
 RETURNS text
 LANGUAGE plpgsql
AS $function$



begin

SET search_path to 'prod';
	
-- вcтавляем новые категории 
insert into categories(id_group, name, percent, user_id, is_income, date_from, date_to, is_activ)
VALUES(null, _category_name, 1, _user_id, _is_income, current_timestamp, '9999-12-31'::timestamp, true);

return 'ok';

	
end
$function$
;
