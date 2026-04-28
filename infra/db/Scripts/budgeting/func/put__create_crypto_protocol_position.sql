DROP FUNCTION IF EXISTS budgeting.put__create_crypto_protocol_position;
CREATE FUNCTION budgeting.put__create_crypto_protocol_position(
    _user_id bigint,
    _investment_account_id bigint,
    _protocol_name text,
    _position_type text,
    _asset_symbol text,
    _quantity numeric DEFAULT NULL,
    _cost_basis_in_base numeric DEFAULT 0,
    _current_quantity numeric DEFAULT NULL,
    _current_value_in_base numeric DEFAULT 0,
    _rewards_claimed_in_base numeric DEFAULT 0,
    _rewards_unclaimed_in_base numeric DEFAULT 0,
    _crypto_asset_id bigint DEFAULT NULL,
    _network_code text DEFAULT NULL,
    _deposited_at date DEFAULT NULL,
    _comment text DEFAULT NULL,
    _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
    _investment_asset_type text;
    _position_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind, investment_asset_type
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind, _investment_asset_type
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF _account_kind <> 'investment' OR _investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Protocol positions require a crypto investment account';
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    IF NULLIF(btrim(_protocol_name), '') IS NULL OR NULLIF(btrim(_asset_symbol), '') IS NULL THEN
        RAISE EXCEPTION 'Protocol name and asset symbol are required';
    END IF;

    IF _position_type NOT IN ('staking', 'lending', 'liquidity_pool', 'vault', 'other') THEN
        RAISE EXCEPTION 'Unsupported protocol position type: %', _position_type;
    END IF;

    INSERT INTO crypto_protocol_positions (
        owner_type,
        owner_user_id,
        owner_family_id,
        investment_account_id,
        crypto_asset_id,
        protocol_name,
        position_type,
        network_code,
        asset_symbol,
        quantity,
        cost_basis_in_base,
        current_quantity,
        current_value_in_base,
        rewards_claimed_in_base,
        rewards_unclaimed_in_base,
        deposited_at,
        comment,
        metadata,
        created_by_user_id
    )
    VALUES (
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        _investment_account_id,
        _crypto_asset_id,
        btrim(_protocol_name),
        _position_type,
        NULLIF(btrim(_network_code), ''),
        btrim(_asset_symbol),
        _quantity,
        COALESCE(_cost_basis_in_base, 0),
        COALESCE(_current_quantity, _quantity),
        COALESCE(_current_value_in_base, _cost_basis_in_base, 0),
        COALESCE(_rewards_claimed_in_base, 0),
        COALESCE(_rewards_unclaimed_in_base, 0),
        COALESCE(_deposited_at, current_date),
        NULLIF(btrim(_comment), ''),
        COALESCE(_metadata, '{}'::jsonb),
        _user_id
    )
    RETURNING id INTO _position_id;

    RETURN (
        SELECT item
        FROM jsonb_array_elements(budgeting.get__crypto_protocol_positions(_user_id, _investment_account_id, NULL)) item
        WHERE (item ->> 'id')::bigint = _position_id
    );
END
$function$;

