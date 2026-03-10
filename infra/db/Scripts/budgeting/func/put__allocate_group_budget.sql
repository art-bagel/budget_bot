-- Description:
--   Allocates budget from a source category to the members of a configured group.
-- Parameters:
--   _user_id bigint - Operation owner.
--   _from_category_id bigint - Budget source category.
--   _group_id bigint - Group category identifier.
--   _amount_in_base numeric - Amount to distribute in the user's base currency.
--   _comment text - Optional comment.
-- Returns:
--   jsonb - Operation identifier and number of affected child categories.
CREATE OR REPLACE FUNCTION budgeting.put__allocate_group_budget(
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
BEGIN
    SET search_path TO budgeting;

    IF _amount_in_base <= 0 THEN
        RAISE EXCEPTION 'Allocated amount must be positive';
    END IF;

    SELECT base_currency_code
    INTO _base_currency_code
    FROM users
    WHERE id = _user_id;

    IF _base_currency_code IS NULL THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    SELECT kind, name
    INTO _source_kind, _source_name
    FROM categories
    WHERE id = _from_category_id
      AND user_id = _user_id
      AND is_active;

    IF _source_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active source category %', _from_category_id;
    END IF;

    IF _source_kind = 'group' THEN
        RAISE EXCEPTION 'Source category % cannot be of kind %', _from_category_id, _source_kind;
    END IF;

    IF _source_kind = 'system' AND _source_name <> 'Unallocated' THEN
        RAISE EXCEPTION 'Source system category % is not supported', _from_category_id;
    END IF;

    SELECT kind
    INTO _group_kind
    FROM categories
    WHERE id = _group_id
      AND user_id = _user_id
      AND is_active;

    IF _group_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active group category %', _group_id;
    END IF;

    IF _group_kind <> 'group' THEN
        RAISE EXCEPTION 'Category % is not a group', _group_id;
    END IF;

    IF _source_kind = 'system' THEN
        SELECT COALESCE(sum(cbb.amount), 0)
        INTO _from_balance
        FROM categories c
        LEFT JOIN current_budget_balances cbb
          ON cbb.category_id = c.id
         AND cbb.currency_code = _base_currency_code
        WHERE c.user_id = _user_id
          AND c.kind = 'system'
          AND c.is_active;
    ELSE
        SELECT COALESCE((
            SELECT amount
            FROM current_budget_balances
            WHERE category_id = _from_category_id
              AND currency_code = _base_currency_code
        ), 0)
        INTO _from_balance
        ;
    END IF;

    IF _from_balance < round(_amount_in_base, 2) THEN
        RAISE EXCEPTION 'Insufficient budget in category %', _from_category_id;
    END IF;

    WITH RECURSIVE expanded_members AS (
        SELECT
            gm.child_category_id AS category_id,
            gm.share::numeric AS effective_share,
            ARRAY[_group_id, gm.child_category_id]::bigint[] AS path
        FROM group_members gm
        JOIN categories c
          ON c.id = gm.child_category_id
        WHERE gm.group_id = _group_id
          AND c.user_id = _user_id
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
          AND c.user_id = _user_id
          AND c.is_active
          AND NOT gm.child_category_id = ANY(em.path)
    ),
    leaf_members AS (
        SELECT em.category_id
        FROM expanded_members em
        JOIN categories c
          ON c.id = em.category_id
        WHERE c.kind = 'regular'
        GROUP BY em.category_id
    )
    SELECT count(*)
    INTO _member_count
    FROM leaf_members;

    IF _member_count = 0 THEN
        RAISE EXCEPTION 'Group % has no active child categories', _group_id;
    END IF;

    INSERT INTO operations (user_id, type, comment)
    VALUES (_user_id, 'group_allocate', _comment)
    RETURNING id
    INTO _operation_id;

    INSERT INTO budget_entries (operation_id, category_id, currency_code, amount)
    VALUES (_operation_id, _from_category_id, _base_currency_code, -round(_amount_in_base, 2));

    PERFORM budgeting.put__apply_current_budget_delta(
        _from_category_id,
        _base_currency_code,
        -round(_amount_in_base, 2)
    );

    FOR _member IN
        WITH RECURSIVE expanded_members AS (
            SELECT
                gm.child_category_id AS category_id,
                gm.share::numeric AS effective_share,
                ARRAY[_group_id, gm.child_category_id]::bigint[] AS path
            FROM group_members gm
            JOIN categories c
              ON c.id = gm.child_category_id
            WHERE gm.group_id = _group_id
              AND c.user_id = _user_id
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
              AND c.user_id = _user_id
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
        ORDER BY em.category_id
    LOOP
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
