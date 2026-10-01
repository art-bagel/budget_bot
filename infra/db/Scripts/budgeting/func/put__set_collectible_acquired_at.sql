-- Acquisition date is descriptive. Editing it does not reorder posted payments.
CREATE OR REPLACE FUNCTION budgeting.put__set_collectible_acquired_at(
 _uid bigint, _position_id bigint, _acquired_at date
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE p record;
BEGIN
 SET search_path TO budgeting;
 SELECT * INTO p FROM portfolio_positions WHERE id=_position_id FOR UPDATE;
 IF p.id IS NULL OR p.asset_type_code<>'collectible' OR NOT has__owner_access(_uid,p.owner_type,p.owner_user_id,p.owner_family_id) THEN
  RAISE EXCEPTION 'Нет доступа к предмету';
 END IF;
 IF _acquired_at IS NOT NULL AND NOT isfinite(_acquired_at) THEN RAISE EXCEPTION 'Некорректная дата приобретения'; END IF;
 UPDATE portfolio_positions SET metadata=(metadata-'acquired_at')||CASE WHEN _acquired_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('acquired_at',_acquired_at) END WHERE id=p.id;
 RETURN get__portfolio_position(_uid,p.id);
END $f$;

-- Only descriptive fields; quantities, cost and financing cannot be edited here.
CREATE OR REPLACE FUNCTION budgeting.put__edit_collectible_details(
 _uid bigint, _position_id bigint, _details jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE p record; m jsonb;
BEGIN
 SET search_path TO budgeting;
 SELECT * INTO p FROM portfolio_positions WHERE id=_position_id FOR UPDATE;
 IF p.id IS NULL OR p.asset_type_code<>'collectible' OR NOT has__owner_access(_uid,p.owner_type,p.owner_user_id,p.owner_family_id) THEN
  RAISE EXCEPTION 'Нет доступа к предмету';
 END IF;
 IF jsonb_typeof(_details)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(_details) k WHERE k NOT IN ('title','comment','acquired_at','item_kind','item_link','image_url','item_attributes')) THEN
  RAISE EXCEPTION 'Недопустимые параметры предмета';
 END IF;
 IF _details ? 'title' AND (length(btrim(COALESCE(_details->>'title','')))=0 OR length(_details->>'title')>200) THEN RAISE EXCEPTION 'Укажите название до 200 символов'; END IF;
 IF length(_details->>'comment')>2000 THEN RAISE EXCEPTION 'Комментарий слишком длинный'; END IF;
 m:=calc__collectible_metadata(p.metadata||(_details-'title'-'comment'));
 UPDATE portfolio_positions SET
 title=CASE WHEN _details ? 'title' THEN btrim(_details->>'title') ELSE title END,
 comment=CASE WHEN _details ? 'comment' THEN _details->>'comment' ELSE comment END,
 metadata=(metadata-'acquired_at'-'item_kind'-'item_link'-'image_url'-'item_attributes')||m WHERE id=p.id;
 RETURN get__portfolio_position(_uid,p.id);
END $f$;
