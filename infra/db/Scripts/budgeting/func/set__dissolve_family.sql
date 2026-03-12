-- Description:
--   Completely removes a family and all related financial data.
--   Only the family owner can dissolve the family.
--   All family bank accounts, categories, and operations are deleted.
--   Members' personal accounts and data are not affected.
CREATE OR REPLACE FUNCTION budgeting.set__dissolve_family(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT fm.family_id
    INTO _family_id
    FROM family_members fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = _user_id
      AND fm.role = 'owner'
      AND f.is_active;

    IF _family_id IS NULL THEN
        RAISE EXCEPTION 'User % is not an owner of any active family', _user_id;
    END IF;

    -- lot_consumptions must be removed before fx_lots and operations
    -- because they have FK references to both without CASCADE.
    DELETE FROM lot_consumptions
    WHERE operation_id IN (
        SELECT id FROM operations
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    ) OR lot_id IN (
        SELECT fl.id FROM fx_lots fl
        JOIN bank_accounts ba ON ba.id = fl.bank_account_id
        WHERE ba.owner_type = 'family' AND ba.owner_family_id = _family_id
    );

    DELETE FROM fx_lots
    WHERE bank_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- Cascade: bank_entries, budget_entries, current_bank_balances,
    -- current_budget_balances are removed via ON DELETE CASCADE from
    -- operations / bank_accounts / categories.
    DELETE FROM operations
    WHERE owner_type = 'family' AND owner_family_id = _family_id;

    DELETE FROM categories
    WHERE owner_type = 'family' AND owner_family_id = _family_id;

    DELETE FROM bank_accounts
    WHERE owner_type = 'family' AND owner_family_id = _family_id;

    DELETE FROM family_invitations WHERE family_id = _family_id;
    DELETE FROM family_members    WHERE family_id = _family_id;
    DELETE FROM families          WHERE id = _family_id;

    RETURN jsonb_build_object(
        'status', 'dissolved',
        'family_id', _family_id,
        'dissolved_by_user_id', _user_id
    );
END
$function$;
