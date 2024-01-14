CREATE OR REPLACE FUNCTION prod.get__group_info(_user_id bigint, _group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 volatile 
AS $function$

declare result_json jsonb;

begin
	
set search_path to 'prod';

	
SELECT jsonb_agg(json_build_object(
		'group_name', c2.name, 
		'category_in_group', c.name, 
		'percent', cg.percent,
		'is_group', c.is_group
))
into result_json 
FROM category_user cu 
	 join category_groups cg on cu.category_id = cg.group_id  
	 left join categories c on cg.category_id  = c.id
	 left join categories c2 on cg.group_id = c2.id
where cu.user_id = _user_id 
	  and cu.category_id = _group_id;

return result_json;

	
end
$function$
;
