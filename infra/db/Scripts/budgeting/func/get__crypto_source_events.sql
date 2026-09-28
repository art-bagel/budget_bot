DROP FUNCTION IF EXISTS budgeting.get__crypto_source_events;
CREATE FUNCTION budgeting.get__crypto_source_events(_user_id bigint,_anchor_account_id bigint,_limit integer DEFAULT 50,_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE _account record; _owner_key text;
BEGIN
    SELECT * INTO _account FROM budgeting.bank_accounts WHERE id=_anchor_account_id;
    IF _account.id IS NULL OR NOT budgeting.has__owner_access(_user_id,_account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to source journal account';
    END IF;
    IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 200 OR _offset IS NULL OR _offset<0 THEN
        RAISE EXCEPTION 'Invalid journal pagination';
    END IF;
    _owner_key := _account.owner_type || ':' || CASE WHEN _account.owner_type='user' THEN _account.owner_user_id ELSE _account.owner_family_id END;
    RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY occurred_at,order_in_timestamp),'[]'::jsonb)
        FROM (SELECT * FROM budgeting.crypto_source_events WHERE owner_key=_owner_key
            ORDER BY occurred_at,order_in_timestamp LIMIT _limit OFFSET _offset) e);
END
$function$;
