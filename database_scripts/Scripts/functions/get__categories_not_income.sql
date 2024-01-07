CREATE OR REPLACE FUNCTION prod.get__categories_not_income(_user_id bigint, _is_activ boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 volatile 
AS $function$

-- параметр is_activ прнимате 3 состояния: 1. True - только активные 2. False - только неактивные 3. Null - все категории

declare result_json jsonb;

begin
	
set search_path to 'prod';


if _is_activ is null
then 
	select json_agg(json_build_object('id_category', id, 'name', name, 'is_activ', is_activ)) 
	   into result_json 
	from categories 
	where user_id = _user_id AND is_income = False;
else 
	select json_agg(json_build_object('id_category', id, 'name', name, 'is_activ', is_activ)) 
	   into result_json 
	from categories 
	where user_id = _user_id AND is_income = False and is_activ = _is_activ;
end if;


return result_json;


return 'ok';

	
end
$function$
;