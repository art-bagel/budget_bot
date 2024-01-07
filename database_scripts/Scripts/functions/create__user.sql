CREATE OR REPLACE FUNCTION prod.create__user(_user_id bigint, _username text, _first_name text default null, _last_name text default null)
 RETURNS text
 LANGUAGE plpgsql
 volatile 
AS $function$

-- создаем пользователя если он не существует
-- возвращает статус created для новго пользователя или exists - если такой пользователь уже есть

declare status text := 'created';

BEGIN
	
SET search_path TO 'prod';

if not exists(select id from users where id = _user_id) 
then 
	insert into users(id, username, first_name, last_name)
	values (_user_id, _username, _first_name, _last_name);

else status = 'exists';
end if;

return status;

	
end
$function$
;
