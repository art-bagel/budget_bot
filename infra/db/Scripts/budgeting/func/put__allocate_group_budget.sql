DROP FUNCTION IF EXISTS budgeting.put__allocate_group_budget;
CREATE FUNCTION budgeting.put__allocate_group_budget(
    _user_id bigint,
    _from_category_id bigint,
    _group_id bigint,
    _amount_in_base numeric,
    _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _base_currency_code char(3);
    _source_kind text;
    _source_name text;
    _group_kind text;
    _from_balance numeric(20, 2);
    _operation_id bigint;
    _member_count integer;
    _idx integer := 0;
    _allocated_total numeric(20, 2) := 0;
    _line_amount numeric(20, 2);
    _member record;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _group_owner_type text;
    _group_owner_user_id bigint;
    _group_owner_family_id bigint;
BEGIN
    SET search_path TO budgeting;

    IF _amount_in_base <= 0 THEN
        RAISE EXCEPTION 'Allocated amount must be positive';
    END IF;

    SELECT kind, name, owner_type, owner_user_id, owner_family_id
    INTO _source_kind, _source_name, _owner_type, _owner_user_id, _owner_family_id
    FROM categories
    WHERE id = _from_category_id
      AND is_active;

    IF _source_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active source category %', _from_category_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source category %', _from_category_id;
    END IF;

    IF _source_kind = 'group' THEN
        RAISE EXCEPTION 'Source category % cannot be of kind %', _from_category_id, _source_kind;
    END IF;

    IF _source_kind = 'system' AND _source_name <> 'Unallocated' THEN
        RAISE EXCEPTION 'Source system category % is not supported', _from_category_id;
    END IF;

    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _group_kind, _group_owner_type, _group_owner_user_id, _group_owner_family_id
    FROM categories
    WHERE id = _group_id
      AND is_active;

    IF _group_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active group category %', _group_id;
    END IF;

    IF _group_kind <> 'group' THEN
        RAISE EXCEPTION 'Category % is not a group', _group_id;
    END IF;

    IF _owner_type <> _group_owner_type
       OR COALESCE(_owner_user_id, 0) <> COALESCE(_group_owner_user_id, 0)
       OR COALESCE(_owner_family_id, 0) <> COALESCE(_group_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Group allocation across different owners is not supported';
    END IF;

    _base_currency_code := budgeting.get__owner_base_currency(_owner_type, _owner_user_id, _owner_family_id);

    PERFORM 1 FROM current_budget_balances
    WHERE category_id = _from_category_id
      AND currency_code = _base_currency_code
    FOR UPDATE;

    SELECT COALESCE(amount, 0) INTO _from_balance
    FROM current_budget_balances
    WHERE category_id = _from_category_id
      AND currency_code = _base_currency_code;

    IF _from_balance < round(_amount_in_base, 2) THEN
        RAISE EXCEPTION 'Insufficient budget in category %', _from_category_id;
    END IF;

    -- Expand the group hierarchy once and materialise leaf members with their
    -- aggregated effective shares. _member_count is derived from the same
    -- result set, avoiding a second recursive scan.
    CREATE TEMP TABLE _group_leaf_members ON COMMIT DROP AS
    WITH RECURSIVE expanded_members AS (
        SELECT
            gm.child_category_id AS category_id,
            gm.share::numeric AS effective_share,
            ARRAY[_group_id, gm.child_category_id]::bigint[] AS path
        FROM group_members gm
        JOIN categories c
          ON c.id = gm.child_category_id
        WHERE gm.group_id = _group_id
          AND c.is_active

        UNION ALL

        SELECT
            gm.child_category_id,
            (em.effective_share * gm.share::numeric)::numeric,
            em.path || gm.child_category_id
        FROM expanded_members em
        JOIN categories parent
          ON parent.id = em.category_id
        JOIN group_members gm
          ON gm.group_id = em.category_id
        JOIN categories c
          ON c.id = gm.child_category_id
        WHERE parent.kind = 'group'
          AND c.is_active
          AND NOT gm.child_category_id = ANY(em.path)
    )
    SELECT
        em.category_id AS child_category_id,
        sum(em.effective_share) AS share
    FROM expanded_members em
    JOIN categories c
      ON c.id = em.category_id
    WHERE c.kind = 'regular'
    GROUP BY em.category_id
    ORDER BY em.category_id;

    SELECT count(*) INTO _member_count FROM _group_leaf_members;

    IF _member_count = 0 THEN
        RAISE EXCEPTION 'Group % has no active child categories', _group_id;
    END IF;

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
        'group_allocate',
        _comment
    )
    RETURNING id
    INTO _operation_id;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _from_category_id, _base_currency_code, -round(_amount_in_base, 2));

    PERFORM budgeting.put__apply_current_budget_delta(
        _from_category_id,
        _base_currency_code,
        -round(_amount_in_base, 2)
    );

    FOR _member IN SELECT child_category_id, share FROM _group_leaf_members LOOP
        _idx := _idx + 1;

        IF _idx < _member_count THEN
            _line_amount := round(_amount_in_base * _member.share, 2);
            _allocated_total := _allocated_total + _line_amount;
        ELSE
            _line_amount := round(_amount_in_base, 2) - _allocated_total;
        END IF;

        INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
        VALUES (_operation_id, _member.child_category_id, _base_currency_code, _line_amount);

        PERFORM budgeting.put__apply_current_budget_delta(
            _member.child_category_id,
            _base_currency_code,
            _line_amount
        );
    END LOOP;

    RETURN jsonb_build_object(
        'operation_id', _operation_id,
        'members_count', _member_count
    );
END
$function$;
