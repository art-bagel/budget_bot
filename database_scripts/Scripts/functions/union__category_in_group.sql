
-- создает группу из категорий
-- принимает массив id категорий и массив долей в группе для каждой категории
-- важно соблюдать порядок категорий и процентов в массивах
-- перед созданием группы - очищает ее

CREATE OR REPLACE FUNCTION prod.union__category_in_group(_user_id bigint, _ids_category bigint[], _percents numeric[], _id_group bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$


begin
	
-- проеряем что сумма процентов по всем переданным категориям равняется 100%
IF (select sum(perc) from unnest(_percents) as dt(perc)) != 1 THEN
   RAISE EXCEPTION 'Сумма процентов всех категорий должна равняться 1';
END IF;

IF array_length(_ids_category, 1) != array_length(_percents, 1)THEN
   RAISE EXCEPTION 'Колличестово элеметов в массиве категорий должно равняться колличеству элеметов в массиве процентов';
END IF;


perform clean__category_group(_user_id, _id_group);

create temporary table union_categories on commit drop as 
SELECT category_id, 
       perc,
       _user_id as user_id
from unnest(_ids_category, _percents) as dt(category_id, perc);


update categories c set id_group = _id_group,
						"percent" = perc
from 
	union_categories uc
where 
	c.user_id = uc.user_id
	and c.id = uc.category_id;


return 'ok';

	
end
$function$
;
