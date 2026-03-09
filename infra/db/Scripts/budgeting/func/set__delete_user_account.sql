-- Description:
--   Completely removes a user and all related budgeting data.
-- Parameters:
--   _user_id bigint - User identifier.
-- Returns:
--   jsonb - Deletion status and user identifier.
CREATE OR REPLACE FUNCTION budgeting.set__delete_user_account(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
BEGIN
    SET search_path TO budgeting;

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE id = _user_id
    ) THEN
        RAISE EXCEPTION 'Unknown user id: %', _user_id;
    END IF;

    DELETE FROM group_members
    WHERE group_id IN (
        SELECT id
        FROM categories
        WHERE user_id = _user_id
    )
       OR child_category_id IN (
        SELECT id
        FROM categories
        WHERE user_id = _user_id
    );

    DELETE FROM lot_consumptions
    WHERE operation_id IN (
        SELECT id
        FROM operations
        WHERE user_id = _user_id
    )
       OR lot_id IN (
        SELECT fl.id
        FROM fx_lots fl
        JOIN bank_accounts ba
          ON ba.id = fl.bank_account_id
        WHERE ba.user_id = _user_id
    );

    DELETE FROM fx_lots
    WHERE bank_account_id IN (
        SELECT id
        FROM bank_accounts
        WHERE user_id = _user_id
    );

    DELETE FROM operations
    WHERE user_id = _user_id;

    DELETE FROM income_sources
    WHERE user_id = _user_id;

    DELETE FROM categories
    WHERE user_id = _user_id;

    DELETE FROM bank_accounts
    WHERE user_id = _user_id;

    DELETE FROM users
    WHERE id = _user_id;

    RETURN jsonb_build_object(
        'status', 'deleted',
        'user_id', _user_id
    );
END
$function$;
