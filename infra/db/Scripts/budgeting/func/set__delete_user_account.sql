-- Description:
--   Completely removes a user and all related personal budgeting data.
DROP FUNCTION IF EXISTS budgeting.set__delete_user_account;
CREATE FUNCTION budgeting.set__delete_user_account(
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

    -- Family-owned records can preserve audit links to a former member.
    -- Reassign them to the family owner so personal account deletion remains possible.
    UPDATE scheduled_expenses se
    SET created_by_user_id = f.created_by_user_id
    FROM families f
    WHERE se.owner_type = 'family'
      AND se.owner_family_id = f.id
      AND se.created_by_user_id = _user_id
      AND f.created_by_user_id <> _user_id;

    UPDATE portfolio_positions pp
    SET created_by_user_id = f.created_by_user_id
    FROM families f
    WHERE pp.owner_type = 'family'
      AND pp.owner_family_id = f.id
      AND pp.created_by_user_id = _user_id
      AND f.created_by_user_id <> _user_id;

    UPDATE portfolio_events pe
    SET created_by_user_id = f.created_by_user_id
    FROM portfolio_positions pp
    JOIN families f
      ON f.id = pp.owner_family_id
    WHERE pe.position_id = pp.id
      AND pp.owner_type = 'family'
      AND pe.created_by_user_id = _user_id
      AND f.created_by_user_id <> _user_id;

    DELETE FROM family_invitations
    WHERE invited_user_id = _user_id
       OR invited_by_user_id = _user_id;

    DELETE FROM external_connections
    WHERE (owner_type = 'user' AND owner_user_id = _user_id)
       OR linked_account_id IN (
            SELECT id
            FROM bank_accounts
            WHERE owner_type = 'user'
              AND owner_user_id = _user_id
        );

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

    -- portfolio_events.linked_operation_id → operations (no CASCADE)
    -- Delete positions first so portfolio_events are removed via CASCADE before operations are deleted
    DELETE FROM portfolio_positions
    WHERE investment_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'user' AND owner_user_id = _user_id
    );

    DELETE FROM operations
    WHERE owner_type = 'user'
      AND owner_user_id = _user_id;

    DELETE FROM income_sources
    WHERE user_id = _user_id;

    -- scheduled_expenses.category_id → categories (no CASCADE)
    DELETE FROM scheduled_expenses
    WHERE category_id IN (
        SELECT id FROM categories
        WHERE owner_type = 'user' AND owner_user_id = _user_id
    );

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
