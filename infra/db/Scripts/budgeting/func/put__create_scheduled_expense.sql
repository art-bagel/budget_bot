CREATE OR REPLACE FUNCTION budgeting.put__create_scheduled_expense(
    _user_id        bigint,
    _category_id    bigint,
    _bank_account_id bigint,
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
    _category_owner_type     text;
    _category_owner_user_id  bigint;
    _category_owner_family_id bigint;
    _category_kind           text;
    _bank_owner_type         text;
    _bank_owner_user_id      bigint;
    _bank_owner_family_id    bigint;
    _next_run_at             date;
    _days_until              int;
    _new_id                  bigint;
BEGIN
    SET search_path TO budgeting;

    -- Validate category
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

    -- Validate bank account
    SELECT owner_type, owner_user_id, owner_family_id
    INTO _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id
    FROM bank_accounts
    WHERE id = _bank_account_id AND is_active;

    IF _bank_owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _bank_owner_type, _bank_owner_user_id, _bank_owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _category_owner_type <> _bank_owner_type
       OR COALESCE(_category_owner_user_id, 0)   <> COALESCE(_bank_owner_user_id, 0)
       OR COALESCE(_category_owner_family_id, 0) <> COALESCE(_bank_owner_family_id, 0) THEN
        RAISE EXCEPTION 'Expense category and bank account must have the same owner';
    END IF;

    -- Compute next_run_at starting from tomorrow
    IF _frequency = 'weekly' THEN
        IF _day_of_week IS NULL OR _day_of_week NOT BETWEEN 1 AND 7 THEN
            RAISE EXCEPTION 'day_of_week must be 1–7 for weekly frequency';
        END IF;
        _days_until := (_day_of_week - EXTRACT(ISODOW FROM CURRENT_DATE + 1)::int + 7) % 7;
        _next_run_at := CURRENT_DATE + 1 + _days_until;

    ELSIF _frequency = 'monthly' THEN
        IF _day_of_month IS NULL OR _day_of_month NOT BETWEEN 1 AND 28 THEN
            RAISE EXCEPTION 'day_of_month must be 1–28 for monthly frequency';
        END IF;
        IF EXTRACT(DAY FROM CURRENT_DATE)::int < _day_of_month THEN
            _next_run_at := (date_trunc('month', CURRENT_DATE) + (_day_of_month - 1) * INTERVAL '1 day')::date;
        ELSE
            _next_run_at := (date_trunc('month', CURRENT_DATE + INTERVAL '1 month') + (_day_of_month - 1) * INTERVAL '1 day')::date;
        END IF;

    ELSE
        RAISE EXCEPTION 'Unknown frequency: %', _frequency;
    END IF;

    INSERT INTO scheduled_expenses (
        category_id,
        bank_account_id,
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
        _bank_account_id,
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
        'id',           _new_id,
        'next_run_at',  _next_run_at
    );
END
$function$;
