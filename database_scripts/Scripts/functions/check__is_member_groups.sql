CREATE OR REPLACE FUNCTION prod.check__is_member_groups(_group_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 volatile 
AS $function$


begin
	
set search_path to 'prod';


return (select exists(select group_id
					 FROM category_groups cg
					 where cg.category_id = _group_id));

	
end
$function$
;
