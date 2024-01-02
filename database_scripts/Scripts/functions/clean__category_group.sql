
-- очищает группу, проставляя каждой категоии пустую группу и 1 (100%) в поле процент 

CREATE OR REPLACE FUNCTION prod.clean__category_group(_user_id bigint, _id_group bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$


begin

update categories set id_group = null,
					  "percent" = 1
where user_id = _user_id
	  and id_group = _id_group;

return 'ok';

	
end
$function$
;
