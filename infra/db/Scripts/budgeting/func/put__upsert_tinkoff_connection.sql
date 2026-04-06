DROP FUNCTION IF EXISTS budgeting.put__upsert_tinkoff_connection;
CREATE FUNCTION budgeting.put__upsert_tinkoff_connection(
    _user_id bigint,
    _token text,
    _provider_account_id text,
    _linked_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _row record;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);
    IF _family_id IS NOT NULL THEN
        _owner_type := 'family';
        _owner_user_id := NULL;
        _owner_family_id := _family_id;
    ELSE
        _owner_type := 'user';
        _owner_user_id := _user_id;
        _owner_family_id := NULL;
    END IF;

    INSERT INTO external_connections (
        owner_type,
        owner_user_id,
        owner_family_id,
        provider,
        provider_account_id,
        linked_account_id,
        credentials
    )
    VALUES (
        _owner_type,
        _owner_user_id,
        _owner_family_id,
        'tinkoff',
        _provider_account_id,
        _linked_account_id,
        jsonb_build_object('token', _token)
    )
    ON CONFLICT (provider, provider_account_id, owner_user_id, owner_family_id)
    DO UPDATE SET
        credentials = EXCLUDED.credentials,
        linked_account_id = EXCLUDED.linked_account_id,
        is_active = true
    RETURNING id, provider_account_id, linked_account_id, created_at
    INTO _row;

    RETURN jsonb_build_object(
        'id', _row.id,
        'provider_account_id', _row.provider_account_id,
        'linked_account_id', _row.linked_account_id,
        'created_at', _row.created_at
    );
END
$function$;
