CREATE OR REPLACE FUNCTION prod.union__category_in_group(_user_id bigint, _ids_category bigint[], _percents numeric[], _group_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$


-- создает группу из категорий
-- принимает массив id категорий и массив долей в группе для каждой категории
-- важно соблюдать порядок категорий и процентов в массивах

begin
	
set search_path to 'prod';
	
-- проеряем что сумма процентов по всем переданным категориям равняется 100%
IF (select sum(perc) from unnest(_percents) as dt(perc)) != 1 THEN
   RAISE EXCEPTION 'Сумма процентов всех категорий должна равняться 1';
END IF;

IF array_length(_ids_category, 1) != array_length(_percents, 1)THEN
   RAISE EXCEPTION 'Колличестово элеметов в массиве категорий должно равняться колличеству элеметов в массиве процентов';
END IF;



insert into category_groups(user_id, group_id, category_id, "percent")
SELECT _user_id,
	   _group_id,
	   category_id, 
       perc
from unnest(_ids_category, _percents) as dt(category_id, perc);



return 'ok';

	
end
$function$
;
