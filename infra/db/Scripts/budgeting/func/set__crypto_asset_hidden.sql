CREATE OR REPLACE FUNCTION budgeting.set__crypto_asset_hidden(
    _user_id bigint, _account_id bigint, _asset_id bigint, _hidden boolean
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE _detail jsonb;
BEGIN
    _detail := budgeting.get__crypto_asset_detail(_user_id, _account_id, _asset_id);
    IF _detail IS NULL THEN RAISE EXCEPTION 'Unknown wallet asset'; END IF;
    IF _hidden AND (_detail->>'quantity')::numeric <> 0 THEN
        RAISE EXCEPTION 'Only an empty asset can be hidden';
    END IF;
    IF _hidden THEN
        INSERT INTO budgeting.crypto_asset_visibility VALUES (_user_id, _account_id, _asset_id)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM budgeting.crypto_asset_visibility WHERE user_id=_user_id
            AND investment_account_id=_account_id AND crypto_asset_id=_asset_id;
    END IF;
    RETURN jsonb_build_object('hidden', _hidden);
END
$function$;
