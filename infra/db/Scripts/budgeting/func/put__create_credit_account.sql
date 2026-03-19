CREATE OR REPLACE FUNCTION budgeting.put__create_credit_account(
    _user_id              bigint,
    _name                 text,
    _credit_kind          text,
    _currency_code        char(3),
    _initial_debt         numeric DEFAULT 0,
    _owner_type           text DEFAULT 'user',
    _interest_rate        numeric DEFAULT NULL,
    _payment_day          smallint DEFAULT NULL,
    _credit_started_at    date DEFAULT NULL,
    _credit_ends_at       date DEFAULT NULL,
    _provider_name        text DEFAULT NULL,
    _provider_account_ref text DEFAULT NULL,
    _credit_limit         numeric DEFAULT NULL,
    _target_account_id    bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _normalized_name  text := btrim(_name);
    _owner_user_id    bigint;
    _owner_family_id  bigint;
    _account_id       bigint;
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
        credit_started_at, credit_ends_at, credit_limit,
        provider_name, provider_account_ref,
        is_primary, is_active
    )
    VALUES (
        _owner_type, _owner_user_id, _owner_family_id,
        _normalized_name, 'credit', _credit_kind, _interest_rate, _payment_day,
        _credit_started_at, _credit_ends_at, _credit_limit,
        NULLIF(btrim(_provider_name), ''),
        NULLIF(btrim(_provider_account_ref), ''),
        false, true
    )
    RETURNING id INTO _account_id;

    -- For loans/mortgages: disburse money to a target cash account.
    -- This creates the debt (credit account goes negative) and funds the cash account.
    IF _target_account_id IS NOT NULL AND _initial_debt > 0 THEN
        PERFORM budgeting.put__transfer_between_accounts(
            _user_id,
            _account_id,
            _target_account_id,
            _currency_code,
            _initial_debt,
            'Выдача кредита · ' || _normalized_name
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
            'credit_limit',         ba.credit_limit,
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
