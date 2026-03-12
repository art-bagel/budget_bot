-- Description:
--   Archives an accessible category or group and removes its group bindings.
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
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT kind, name, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _category_name, _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _category_id
      AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
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
      AND parent.is_active;

    IF _parent_group_names IS NOT NULL THEN
        RAISE EXCEPTION 'Category % is still used in groups: %', _category_id, _parent_group_names;
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Base currency is missing for category owner %', _category_id;
    END IF;

    _unallocated_category_id := budgeting.get__owner_system_category_id(
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'Unallocated'
    );

    IF _unallocated_category_id IS NULL THEN
        RAISE EXCEPTION 'System category Unallocated is missing for category owner %', _category_id;
    END IF;

    SELECT COALESCE((
        SELECT amount
        FROM current_budget_balances
        WHERE category_id = _category_id
          AND currency_code = _base_currency_code
    ), 0)
    INTO _category_balance;

    IF _category_balance <> 0 THEN
        INSERT INTO operations (
            actor_user_id,
            owner_type,
            owner_user_id,
            owner_family_id,
            type,
            comment
        )
        VALUES (
            _user_id,
            _owner_type,
            _owner_user_id,
            _owner_family_id,
            'allocate',
            format('Archive category "%s"', _category_name)
        )
        RETURNING id
        INTO _operation_id;

        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES
            (_operation_id, _category_id, _base_currency_code, -_category_balance),
            (_operation_id, _unallocated_category_id, _base_currency_code, _category_balance);

        PERFORM budgeting.put__apply_current_budget_delta(
            _category_id,
            _base_currency_code,
            -_category_balance
        );

        PERFORM budgeting.put__apply_current_budget_delta(
            _unallocated_category_id,
            _base_currency_code,
            _category_balance
        );
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
        'owner_type', _owner_type,
        'owner_user_id', _owner_user_id,
        'owner_family_id', _owner_family_id,
        'is_active', false
    );
END
$function$;
