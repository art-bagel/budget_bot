CREATE OR REPLACE FUNCTION prod.get_one__category_data(_user_id bigint, _category_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 volatile 
AS $function$

declare result_json jsonb;

begin
	
set search_path to 'prod';


select json_build_object('name', name, 'is_income', is_income,  'is_activ', is_activ, 'is_group', is_group, 'is_owner', is_owner)
	   into result_json 
FROM categories c 
	 join category_user cu on cu.category_id = c.id 
where cu.user_id = _user_id
	  and cu.category_id = _category_id
	 ;

return result_json;

	
end
$function$
;
