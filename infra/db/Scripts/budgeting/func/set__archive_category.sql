-- Description:
--   Archives a user category or group and removes its group bindings.
-- Parameters:
--   _user_id bigint - Category owner.
--   _category_id bigint - Category identifier to archive.
-- Returns:
--   jsonb - Archived category identifier and kind.
CREATE OR REPLACE FUNCTION budgeting.set__archive_category(
    _user_id bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_kind text;
    _category_name text;
    _parent_group_names text;
    _base_currency_code char(3);
    _unallocated_category_id bigint;
    _category_balance numeric(20, 2);
    _operation_id bigint;
    _archive_suffix text;
    _archived_name text;
BEGIN
    SET search_path TO budgeting;

    SELECT kind, name
    INTO _category_kind, _category_name
    FROM categories
    WHERE id = _category_id
      AND user_id = _user_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category % for user %', _category_id, _user_id;
    END IF;

    IF _category_kind = 'system' THEN
        RAISE EXCEPTION 'System category % cannot be archived', _category_id;
    END IF;

    SELECT string_agg(parent.name, ', ' ORDER BY parent.name)
    INTO _parent_group_names
    FROM group_members gm
    JOIN categories parent
      ON parent.id = gm.group_id
    WHERE gm.child_category_id = _category_id
      AND parent.user_id = _user_id
      AND parent.is_active;

    IF _parent_group_names IS NOT NULL THEN
        RAISE EXCEPTION 'Category % is still used in groups: %', _category_id, _parent_group_names;
    END IF;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    SELECT id
    INTO _unallocated_category_id
    FROM categories
    WHERE user_id = _user_id
      AND name = 'Unallocated'
      AND kind = 'system'
      AND is_active;

    IF _unallocated_category_id IS NULL THEN
        RAISE EXCEPTION 'System category Unallocated is missing for user %', _user_id;
    END IF;

    SELECT COALESCE(sum(amount), 0)
    INTO _category_balance
    FROM budget_entries
    WHERE category_id = _category_id
      AND currency_code = _base_currency_code;

    IF _category_balance <> 0 THEN
        INSERT INTO operations (user_id, type, comment)
        VALUES (_user_id, 'allocate', format('Archive category "%s"', _category_name))
        RETURNING id
        INTO _operation_id;

        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES
            (_operation_id, _category_id, _base_currency_code, -_category_balance),
            (_operation_id, _unallocated_category_id, _base_currency_code, _category_balance);
    END IF;

    DELETE FROM group_members
    WHERE group_id = _category_id
       OR child_category_id = _category_id;

    _archive_suffix := ' [archived ' || _category_id || ']';
    _archived_name := left(_category_name, 100 - length(_archive_suffix)) || _archive_suffix;

    UPDATE categories
    SET is_active = false,
        name = _archived_name
    WHERE id = _category_id;

    RETURN jsonb_build_object(
        'category_id', _category_id,
        'kind', _category_kind,
        'name', _category_name,
        'is_active', false
    );
END
$function$;
