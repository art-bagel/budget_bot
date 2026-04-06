DROP FUNCTION IF EXISTS budgeting.set__update_credit_account;
CREATE FUNCTION budgeting.set__update_credit_account(
    _user_id bigint,
    _credit_account_id bigint,
    _name text,
    _credit_limit numeric,
    _interest_rate numeric DEFAULT NULL,
    _payment_day smallint DEFAULT NULL,
    _credit_started_at date DEFAULT NULL,
    _credit_ends_at date DEFAULT NULL,
    _provider_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _normalized_name text := btrim(_name);
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _created_at timestamptz;
    _current_balance numeric(20, 8);
    _current_principal numeric(20, 2) := 0;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Bank account name cannot be empty';
    END IF;

    IF _credit_limit IS NULL OR _credit_limit <= 0 THEN
        RAISE EXCEPTION 'Credit limit must be positive';
    END IF;

    IF _interest_rate IS NOT NULL AND _interest_rate < 0 THEN
        RAISE EXCEPTION 'Interest rate must be non-negative';
    END IF;

    IF _payment_day IS NOT NULL AND (_payment_day < 1 OR _payment_day > 31) THEN
        RAISE EXCEPTION 'Payment day must be between 1 and 31';
    END IF;

    IF _credit_started_at IS NOT NULL AND _credit_ends_at IS NOT NULL
       AND _credit_ends_at <= _credit_started_at THEN
        RAISE EXCEPTION 'Credit end date must be after start date';
    END IF;

    SELECT
        ba.owner_type,
        ba.owner_user_id,
        ba.owner_family_id,
        ba.account_kind,
        ba.created_at
    INTO
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _account_kind,
        _created_at
    FROM bank_accounts ba
    WHERE ba.id = _credit_account_id
      AND ba.is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _credit_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _credit_account_id;
    END IF;

    IF _account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Bank account % is not a credit account', _credit_account_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM bank_accounts ba
        WHERE ba.owner_type = _owner_type
          AND ((_owner_type = 'user' AND ba.owner_user_id = _owner_user_id)
               OR (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id))
          AND ba.name = _normalized_name
          AND ba.is_active
          AND ba.id <> _credit_account_id
    ) THEN
        RAISE EXCEPTION 'Active bank account with name "%" already exists', _normalized_name;
    END IF;

    SELECT amount
    INTO _current_balance
    FROM current_bank_balances
    WHERE bank_account_id = _credit_account_id
      AND amount <> 0
    ORDER BY abs(amount) DESC, currency_code
    LIMIT 1;

    _current_principal := round(GREATEST(0, -COALESCE(_current_balance, 0)), 2);

    IF _credit_limit < _current_principal THEN
        RAISE EXCEPTION 'Credit limit cannot be smaller than current outstanding principal';
    END IF;

    UPDATE bank_accounts
    SET
        name = _normalized_name,
        credit_limit = _credit_limit,
        interest_rate = _interest_rate,
        payment_day = _payment_day,
        credit_started_at = _credit_started_at,
        credit_ends_at = _credit_ends_at,
        provider_name = NULLIF(btrim(_provider_name), '')
    WHERE id = _credit_account_id;

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
        WHERE ba.id = _credit_account_id
    );
END
$function$;
