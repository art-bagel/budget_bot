CREATE OR REPLACE FUNCTION budgeting.put__create_scheduled_expense(
    _user_id        bigint,
    _category_id    bigint,
    _amount         numeric,
    _currency_code  char(3),
    _frequency      varchar(10),
    _day_of_week    smallint DEFAULT NULL,
    _day_of_month   smallint DEFAULT NULL,
    _comment        text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _category_owner_type      text;
    _category_owner_user_id   bigint;
    _category_owner_family_id bigint;
    _category_kind            text;
    _next_run_at              date;
    _days_until               int;
    _new_id                   bigint;
BEGIN
    SET search_path TO budgeting;

    -- Validate category access
    SELECT kind, owner_type, owner_user_id, owner_family_id
    INTO _category_kind, _category_owner_type, _category_owner_user_id, _category_owner_family_id
    FROM categories
    WHERE id = _category_id AND is_active;

    IF _category_kind IS NULL THEN
        RAISE EXCEPTION 'Unknown active category %', _category_id;
    END IF;

    IF _category_kind <> 'regular' THEN
        RAISE EXCEPTION 'Scheduled expenses are only supported for regular categories';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _category_owner_type, _category_owner_user_id, _category_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    -- Verify the category's owner has a primary bank account (guard, not blocking)
    IF NOT EXISTS (
        SELECT 1 FROM bank_accounts ba
        WHERE ba.owner_type = _category_owner_type
          AND (
              (_category_owner_type = 'user'   AND ba.owner_user_id   = _category_owner_user_id)
           OR (_category_owner_type = 'family' AND ba.owner_family_id = _category_owner_family_id)
          )
          AND ba.is_primary = TRUE
          AND ba.is_active  = TRUE
    ) THEN
        RAISE EXCEPTION 'No primary bank account found for the category owner';
    END IF;

    -- Compute next_run_at starting from tomorrow
    IF _frequency = 'weekly' THEN
        IF _day_of_week IS NULL OR _day_of_week NOT BETWEEN 1 AND 7 THEN
            RAISE EXCEPTION 'day_of_week must be 1–7 for weekly frequency';
        END IF;
        _days_until  := (_day_of_week - EXTRACT(ISODOW FROM CURRENT_DATE + 1)::int + 7) % 7;
        _next_run_at := CURRENT_DATE + 1 + _days_until;

    ELSIF _frequency = 'monthly' THEN
        IF _day_of_month IS NULL OR _day_of_month NOT BETWEEN 1 AND 31 THEN
            RAISE EXCEPTION 'day_of_month must be 1–31 for monthly frequency';
        END IF;
        -- Clamp to actual last day of the target month so "31st" in February becomes 28/29.
        DECLARE
            _last_day_this  int;
            _last_day_next  int;
            _effective_day  int;
        BEGIN
            _last_day_this := EXTRACT(DAY FROM
                date_trunc('month', CURRENT_DATE + INTERVAL '1 month') - INTERVAL '1 day'
            )::int;
            _effective_day := LEAST(_day_of_month, _last_day_this);

            IF EXTRACT(DAY FROM CURRENT_DATE)::int < _effective_day THEN
                _next_run_at := (date_trunc('month', CURRENT_DATE)
                    + (_effective_day - 1) * INTERVAL '1 day')::date;
            ELSE
                _last_day_next := EXTRACT(DAY FROM
                    date_trunc('month', CURRENT_DATE + INTERVAL '2 months') - INTERVAL '1 day'
                )::int;
                _next_run_at := (date_trunc('month', CURRENT_DATE + INTERVAL '1 month')
                    + (LEAST(_day_of_month, _last_day_next) - 1) * INTERVAL '1 day')::date;
            END IF;
        END;

    ELSE
        RAISE EXCEPTION 'Unknown frequency: %', _frequency;
    END IF;

    INSERT INTO scheduled_expenses (
        category_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        created_by_user_id,
        amount,
        currency_code,
        comment,
        frequency,
        day_of_week,
        day_of_month,
        next_run_at
    )
    VALUES (
        _category_id,
        _category_owner_type,
        _category_owner_user_id,
        _category_owner_family_id,
        _user_id,
        _amount,
        _currency_code,
        _comment,
        _frequency,
        _day_of_week,
        _day_of_month,
        _next_run_at
    )
    RETURNING id INTO _new_id;

    RETURN jsonb_build_object(
        'id',          _new_id,
        'next_run_at', _next_run_at
    );
END
$function$;
