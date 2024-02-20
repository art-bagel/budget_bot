CREATE OR REPLACE FUNCTION prod.disband_group(_user_id bigint, _group_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$



begin
	
set search_path to 'prod';
	
IF not (select is_owner from category_user where user_id = _user_id and category_id = _group_id)
THEN
   RAISE EXCEPTION 'Только владелец группы может ее удалить';
end if;

delete from category_user where category_id = _group_id;

delete from category_groups where group_id = _group_id;

delete from categories where id = _group_id;


return 'ok';

	
end
$function$
;
