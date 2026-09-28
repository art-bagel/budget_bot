DROP FUNCTION IF EXISTS budgeting.get__crypto_account_assets;
CREATE FUNCTION budgeting.get__crypto_account_assets(
    _user_id bigint,
    _investment_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account record;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT *
    INTO _account
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _account.id IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF _account.account_kind <> 'investment' OR _account.investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Account % is not a crypto investment account', _investment_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    SELECT COALESCE(jsonb_agg(detail - 'entries' ORDER BY detail->>'symbol'), '[]'::jsonb)
    INTO _result
    FROM (
        SELECT budgeting.get__crypto_asset_detail(_user_id, _investment_account_id, asset_id) detail
        FROM (
            SELECT DISTINCT (metadata->>'crypto_asset_id')::bigint asset_id
            FROM portfolio_positions
            WHERE investment_account_id=_investment_account_id AND asset_type_code='crypto'
                AND metadata->>'crypto_asset_id' ~ '^[0-9]+$'
        ) assets
    ) details;

    RETURN _result;
END
$function$;
