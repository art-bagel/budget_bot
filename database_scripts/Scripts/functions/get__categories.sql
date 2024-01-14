CREATE OR REPLACE FUNCTION prod.get__categories(_user_id bigint, _is_activ boolean DEFAULT NULL::boolean)
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
	select json_agg(
				json_build_object(
						'id_category', c.id, 
						'name', c.name, 
						'is_income', c.is_income, 
						'is_activ', c.is_activ, 
						'is_group', c.is_group, 
						'is_owner', cu.is_owner
				)
		    ) 
	   into result_json 
	FROM  categories c
		  join category_user cu on cu.category_id = c.id
	where cu.user_id = _user_id;
else 

	select json_agg(
				json_build_object(
						'id_category', c.id, 
						'name', c.name, 
						'is_income', c.is_income, 
						'is_activ', c.is_activ, 
						'is_group', c.is_group, 
						'is_owner', cu.is_owner
				)
		    ) 
	   into result_json 
	FROM  categories c
		  join category_user cu on cu.category_id = c.id
	where cu.user_id = _user_id and is_activ = _is_activ;
end if;

return result_json;


return 'ok';

	
end
$function$
;

