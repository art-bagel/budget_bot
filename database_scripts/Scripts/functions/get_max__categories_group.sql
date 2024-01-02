CREATE OR REPLACE FUNCTION prod.get_max__categories_group(_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$


begin

-- получаем группу последней операции
return  (select  coalesce(max(id_group),0) from categories where user_id = _user_id);

	
end
$function$
;
