-- 1. Extend account_kind to include 'credit'
ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_account_kind;

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS bank_accounts_account_kind_check;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT bank_accounts_account_kind_check
    CHECK (account_kind IN ('cash', 'investment', 'credit'));

-- 2. Rename old primary-only constraint to a clearer name and extend it
ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_investment_primary;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_non_cash_primary
    CHECK (account_kind = 'cash' OR is_primary = false);

-- 3. Add credit-specific columns
ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS credit_kind varchar(30);

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS interest_rate numeric(5, 2);

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS payment_day smallint;

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS credit_started_at date;

ALTER TABLE budgeting.bank_accounts
    ADD COLUMN IF NOT EXISTS credit_ends_at date;

-- 4. Constraints on credit-specific fields
ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_credit_fields;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_credit_fields
    CHECK (
        account_kind = 'credit'
        OR (credit_kind IS NULL AND interest_rate IS NULL AND payment_day IS NULL
            AND credit_started_at IS NULL AND credit_ends_at IS NULL)
    );

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_credit_kind;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_credit_kind
    CHECK (credit_kind IS NULL OR credit_kind IN ('loan', 'credit_card', 'mortgage'));

ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_payment_day;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_payment_day
    CHECK (payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31));

-- 5. Add 'credit_taken' operation type
ALTER TABLE budgeting.operations
    DROP CONSTRAINT IF EXISTS chk_operations_type;

ALTER TABLE budgeting.operations
    ADD CONSTRAINT chk_operations_type
    CHECK (type IN (
        'income', 'allocate', 'group_allocate', 'exchange', 'expense',
        'account_transfer', 'investment_trade', 'investment_income',
        'investment_adjustment', 'reversal', 'credit_taken'
    ));

-- 6. Register the new create-credit-account function
CREATE OR REPLACE FUNCTION budgeting.put__create_credit_account(
    _user_id           bigint,
    _name              text,
    _credit_kind       text,
    _currency_code     char(3),
    _initial_debt      numeric DEFAULT 0,
    _owner_type        text DEFAULT 'user',
    _interest_rate     numeric DEFAULT NULL,
    _payment_day       smallint DEFAULT NULL,
    _credit_started_at date DEFAULT NULL,
    _credit_ends_at    date DEFAULT NULL,
    _provider_name     text DEFAULT NULL,
    _provider_account_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _normalized_name  text := btrim(_name);
    _owner_user_id    bigint;
    _owner_family_id  bigint;
    _account_id       bigint;
    _operation_id     bigint;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Bank account name cannot be empty';
    END IF;

    IF _credit_kind NOT IN ('loan', 'credit_card', 'mortgage') THEN
        RAISE EXCEPTION 'Unsupported credit kind: %. Use loan, credit_card, or mortgage', _credit_kind;
    END IF;

    IF _initial_debt < 0 THEN
        RAISE EXCEPTION 'Initial debt cannot be negative';
    END IF;

    IF _payment_day IS NOT NULL AND (_payment_day < 1 OR _payment_day > 31) THEN
        RAISE EXCEPTION 'Payment day must be between 1 and 31';
    END IF;

    IF _credit_kind IN ('loan', 'mortgage') AND _credit_started_at IS NOT NULL AND _credit_ends_at IS NOT NULL
       AND _credit_ends_at <= _credit_started_at THEN
        RAISE EXCEPTION 'Credit end date must be after start date';
    END IF;

    IF _owner_type = 'user' THEN
        _owner_user_id := _user_id;
    ELSIF _owner_type = 'family' THEN
        _owner_family_id := budgeting.get__user_family_id(_user_id);
        IF _owner_family_id IS NULL THEN
            RAISE EXCEPTION 'User % does not belong to a family', _user_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported owner type: %', _owner_type;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM bank_accounts ba
        WHERE ba.owner_type = _owner_type
          AND (
                (_owner_type = 'user'   AND ba.owner_user_id   = _owner_user_id)
                OR
                (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id)
              )
          AND ba.name = _normalized_name
          AND ba.is_active
    ) THEN
        RAISE EXCEPTION 'Active bank account with name "%" already exists', _normalized_name;
    END IF;

    INSERT INTO bank_accounts (
        owner_type, owner_user_id, owner_family_id,
        name, account_kind, credit_kind, interest_rate, payment_day,
        credit_started_at, credit_ends_at,
        provider_name, provider_account_ref,
        is_primary, is_active
    )
    VALUES (
        _owner_type, _owner_user_id, _owner_family_id,
        _normalized_name, 'credit', _credit_kind, _interest_rate, _payment_day,
        _credit_started_at, _credit_ends_at,
        NULLIF(btrim(_provider_name), ''),
        NULLIF(btrim(_provider_account_ref), ''),
        false, true
    )
    RETURNING id INTO _account_id;

    IF _initial_debt > 0 THEN
        INSERT INTO operations (
            actor_user_id, owner_type, owner_user_id, owner_family_id, type, comment
        )
        VALUES (
            _user_id, _owner_type, _owner_user_id, _owner_family_id,
            'credit_taken', 'Начальный долг · ' || _normalized_name
        )
        RETURNING id INTO _operation_id;

        INSERT INTO bank_entries (operation_id, bank_account_id, currency_code, amount)
        VALUES (_operation_id, _account_id, _currency_code, _initial_debt);

        PERFORM budgeting.put__apply_current_bank_delta(
            _account_id, _currency_code, _initial_debt, _initial_debt
        );
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'id',                   ba.id,
            'name',                 ba.name,
            'owner_type',           ba.owner_type,
            'owner_user_id',        ba.owner_user_id,
            'owner_family_id',      ba.owner_family_id,
            'owner_name',           CASE
                                        WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                                        ELSE f.name
                                    END,
            'account_kind',         ba.account_kind,
            'credit_kind',          ba.credit_kind,
            'interest_rate',        ba.interest_rate,
            'payment_day',          ba.payment_day,
            'credit_started_at',    ba.credit_started_at,
            'credit_ends_at',       ba.credit_ends_at,
            'provider_name',        ba.provider_name,
            'provider_account_ref', ba.provider_account_ref,
            'is_primary',           ba.is_primary,
            'is_active',            ba.is_active,
            'created_at',           ba.created_at
        )
        FROM bank_accounts ba
        LEFT JOIN users u ON u.id = ba.owner_user_id
        LEFT JOIN families f ON f.id = ba.owner_family_id
        WHERE ba.id = _account_id
    );
END
$function$;

-- 7. Update get__bank_accounts to expose credit fields and allow 'credit' filter
CREATE OR REPLACE FUNCTION budgeting.get__bank_accounts(
    _user_id bigint,
    _is_active boolean DEFAULT true,
    _account_kind text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _normalized_account_kind text := nullif(trim(_account_kind), '');
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    IF _normalized_account_kind IS NOT NULL
       AND _normalized_account_kind NOT IN ('cash', 'investment', 'credit') THEN
        RAISE EXCEPTION 'Unsupported bank account kind filter: %', _normalized_account_kind;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', ba.id,
                'name', ba.name,
                'owner_type', ba.owner_type,
                'owner_user_id', ba.owner_user_id,
                'owner_family_id', ba.owner_family_id,
                'owner_name', CASE
                    WHEN ba.owner_type = 'user' THEN COALESCE(u.first_name, u.username, 'Personal')
                    ELSE f.name
                END,
                'account_kind', ba.account_kind,
                'credit_kind', ba.credit_kind,
                'interest_rate', ba.interest_rate,
                'payment_day', ba.payment_day,
                'credit_started_at', ba.credit_started_at,
                'credit_ends_at', ba.credit_ends_at,
                'provider_name', ba.provider_name,
                'provider_account_ref', ba.provider_account_ref,
                'is_primary', ba.is_primary,
                'is_active', ba.is_active,
                'created_at', ba.created_at
            )
            ORDER BY ba.owner_type, ba.account_kind, ba.is_primary DESC, ba.id
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM bank_accounts ba
    LEFT JOIN users u ON u.id = ba.owner_user_id
    LEFT JOIN families f ON f.id = ba.owner_family_id
    WHERE (
            (ba.owner_type = 'user' AND ba.owner_user_id = _user_id)
            OR
            (ba.owner_type = 'family' AND ba.owner_family_id = _family_id)
          )
      AND (_is_active IS NULL OR ba.is_active = _is_active)
      AND (_normalized_account_kind IS NULL OR ba.account_kind = _normalized_account_kind);

    RETURN _result;
END
$function$;
