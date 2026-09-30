-- An item keeps only its kind, an https link and short text attributes.
-- Shared by every path that opens a collectible position.
DROP FUNCTION IF EXISTS budgeting.calc__collectible_metadata;
CREATE FUNCTION budgeting.calc__collectible_metadata(_metadata jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
    _metadata := COALESCE(_metadata, '{}'::jsonb);
    IF COALESCE(_metadata ->> 'item_kind', '') NOT IN ('telegram_gift', 'sticker', 'cs2_skin', 'physical', 'other') THEN
        RAISE EXCEPTION 'Укажите вид предмета коллекции';
    END IF;
    IF (_metadata ->> 'item_link') !~ '^https://\S+$' OR length(_metadata ->> 'item_link') > 500 THEN
        RAISE EXCEPTION 'Ссылка на предмет должна начинаться с https://';
    END IF;
    IF jsonb_typeof(COALESCE(_metadata -> 'item_attributes', '{}'::jsonb)) <> 'object'
       OR (SELECT count(*) > 20 OR bool_or(jsonb_typeof(value) <> 'string' OR length(key) > 40 OR length(value #>> '{}') > 200)
           FROM jsonb_each(COALESCE(_metadata -> 'item_attributes', '{}'::jsonb))) THEN
        RAISE EXCEPTION 'Параметры предмета: до 20 текстовых полей по 200 символов';
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object(
        'item_kind', _metadata -> 'item_kind',
        'item_link', _metadata -> 'item_link',
        'item_attributes', _metadata -> 'item_attributes'
    ));
END
$function$;
