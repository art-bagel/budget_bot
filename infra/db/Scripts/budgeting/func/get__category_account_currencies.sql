-- Returns currencies with positive balance on the primary bank account
-- of the category's owner (user→personal account, family→family account).
DROP FUNCTION IF EXISTS budgeting.get__category_account_currencies;
CREATE FUNCTION budgeting.get__category_account_currencies(
    _user_id     bigint,
    _category_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _owner_type      text;
    _owner_user_id   bigint;
    _owner_family_id bigint;
    _result          jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT c.owner_type, c.owner_user_id, c.owner_family_id
    INTO _owner_type, _owner_user_id, _owner_family_id
    FROM categories c
    WHERE c.id = _category_id
      AND budgeting.has__owner_access(_user_id, c.owner_type, c.owner_user_id, c.owner_family_id);

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Access denied to category %', _category_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'code',   cbb.currency_code,
                'amount', cbb.amount
            )
            ORDER BY cbb.amount DESC
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM bank_accounts ba
    JOIN current_bank_balances cbb ON cbb.bank_account_id = ba.id
    WHERE ba.owner_type = _owner_type
      AND (
              (_owner_type = 'user'   AND ba.owner_user_id   = _owner_user_id)
           OR (_owner_type = 'family' AND ba.owner_family_id = _owner_family_id)
          )
      AND ba.is_primary = TRUE
      AND ba.is_active  = TRUE
      AND cbb.amount    > 0;

    RETURN _result;
END
$function$;
