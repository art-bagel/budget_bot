-- Description:
--   Completely removes a user and all related personal budgeting data.
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

    IF budgeting.get__user_family_id(_user_id) IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot delete user account while user belongs to a family';
    END IF;

    DELETE FROM family_invitations
    WHERE invited_user_id = _user_id
       OR invited_by_user_id = _user_id;

    DELETE FROM lot_consumptions
    WHERE operation_id IN (
        SELECT id
        FROM operations
        WHERE owner_type = 'user'
          AND owner_user_id = _user_id
    )
       OR lot_id IN (
        SELECT fl.id
        FROM fx_lots fl
        JOIN bank_accounts ba
          ON ba.id = fl.bank_account_id
        WHERE ba.owner_type = 'user'
          AND ba.owner_user_id = _user_id
    );

    DELETE FROM fx_lots
    WHERE bank_account_id IN (
        SELECT id
        FROM bank_accounts
        WHERE owner_type = 'user'
          AND owner_user_id = _user_id
    );

    DELETE FROM operations
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id;

    DELETE FROM income_sources
    WHERE user_id = _user_id;

    DELETE FROM categories
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id;

    DELETE FROM bank_accounts
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id;

    DELETE FROM users
    WHERE id = _user_id;

    RETURN jsonb_build_object(
        'status', 'deleted',
        'user_id', _user_id
    );
END
$function$;
