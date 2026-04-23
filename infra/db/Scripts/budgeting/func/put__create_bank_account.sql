DROP FUNCTION IF EXISTS budgeting.put__create_bank_account;
CREATE FUNCTION budgeting.put__create_bank_account(
    _user_id bigint,
    _name text,
    _owner_type text DEFAULT 'user',
    _account_kind text DEFAULT 'investment',
    _investment_asset_type text DEFAULT NULL,
    _provider_name text DEFAULT NULL,
    _provider_account_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _normalized_name text := btrim(_name);
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_id bigint;
    _is_primary boolean := false;
BEGIN
    SET search_path TO budgeting;

    IF _normalized_name = '' THEN
        RAISE EXCEPTION 'Bank account name cannot be empty';
    END IF;

    IF _account_kind NOT IN ('cash', 'investment') THEN
        RAISE EXCEPTION 'Unsupported bank account kind: %', _account_kind;
    END IF;

    IF _account_kind = 'investment' AND COALESCE(NULLIF(BTRIM(_investment_asset_type), ''), '') NOT IN ('security', 'deposit', 'crypto', 'other') THEN
        RAISE EXCEPTION 'Investment account requires asset type (security, deposit, crypto, other)';
    END IF;

    IF _owner_type = 'user' THEN
        _owner_user_id := _user_id;
    ELSIF _owner_type = 'family' THEN
        _owner_family_id := budgeting.get__user_family_id(_user_id);

        IF _owner_family_id IS NULL THEN
            RAISE EXCEPTION 'User % does not belong to a family', _user_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported bank account owner type: %', _owner_type;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM bank_accounts ba
        WHERE ba.owner_type = _owner_type
          AND (
                (_owner_type = 'user' AND ba.owner_user_id = _owner_user_id)
                OR
                (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id)
              )
          AND ba.name = _normalized_name
          AND ba.is_active
    ) THEN
        RAISE EXCEPTION 'Active bank account with name "%" already exists', _normalized_name;
    END IF;

    IF _account_kind = 'cash' THEN
        SELECT NOT EXISTS (
            SELECT 1
            FROM bank_accounts ba
            WHERE ba.owner_type = _owner_type
              AND (
                    (_owner_type = 'user' AND ba.owner_user_id = _owner_user_id)
                    OR
                    (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id)
                  )
              AND ba.account_kind = 'cash'
              AND ba.is_primary = true
              AND ba.is_active
        )
        INTO _is_primary;
    END IF;

    INSERT INTO bank_accounts (
        owner_type,
        owner_user_id,
        owner_family_id,
        name,
        account_kind,
        investment_asset_type,
        provider_name,
        provider_account_ref,
        is_primary,
        is_active
    )
    VALUES (
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _normalized_name,
        _account_kind,
        CASE WHEN _account_kind = 'investment' THEN NULLIF(btrim(_investment_asset_type), '') ELSE NULL END,
        NULLIF(btrim(_provider_name), ''),
        NULLIF(btrim(_provider_account_ref), ''),
        _is_primary,
        true
    )
    RETURNING id
    INTO _account_id;

    RETURN (
        SELECT jsonb_build_object(
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
            'investment_asset_type', ba.investment_asset_type,
            'provider_name', ba.provider_name,
            'provider_account_ref', ba.provider_account_ref,
            'is_primary', ba.is_primary,
            'is_active', ba.is_active,
            'created_at', ba.created_at
        )
        FROM bank_accounts ba
        LEFT JOIN users u
          ON u.id = ba.owner_user_id
        LEFT JOIN families f
          ON f.id = ba.owner_family_id
        WHERE ba.id = _account_id
    );
END
$function$;
