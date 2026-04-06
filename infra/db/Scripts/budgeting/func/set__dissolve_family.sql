-- Description:
--   Completely removes a family and all related financial data.
--   Only the family owner can dissolve the family.
--   All family bank accounts, categories, and operations are deleted.
--   Members' personal accounts and data are not affected.
DROP FUNCTION IF EXISTS budgeting.set__dissolve_family;
CREATE FUNCTION budgeting.set__dissolve_family(
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

    -- 1. lot_consumptions — FK to operations and fx_lots, no CASCADE
    DELETE FROM lot_consumptions
    WHERE operation_id IN (
        SELECT id FROM operations
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    ) OR lot_id IN (
        SELECT fl.id FROM fx_lots fl
        JOIN bank_accounts ba ON ba.id = fl.bank_account_id
        WHERE ba.owner_type = 'family' AND ba.owner_family_id = _family_id
    );

    -- 2. fx_lots — FK to bank_accounts, no CASCADE
    DELETE FROM fx_lots
    WHERE bank_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 3. Family operations (cascades bank_entries + budget_entries belonging to them)
    DELETE FROM operations
    WHERE owner_type = 'family' AND owner_family_id = _family_id;

    -- 4. budget_entries from USER operations that reference family categories
    DELETE FROM budget_entries
    WHERE category_id IN (
        SELECT id FROM categories
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 5. scheduled_expenses referencing family categories — no CASCADE
    DELETE FROM scheduled_expenses
    WHERE category_id IN (
        SELECT id FROM categories
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 6. Categories (cascades current_budget_balances)
    DELETE FROM categories
    WHERE owner_type = 'family' AND owner_family_id = _family_id;

    -- 7. bank_entries from USER operations that reference family bank accounts
    DELETE FROM bank_entries
    WHERE bank_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 8. income_source_pattern_lines referencing family bank accounts — no CASCADE
    DELETE FROM income_source_pattern_lines
    WHERE bank_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 9. portfolio_positions referencing family investment accounts — no CASCADE
    --    portfolio_events are removed via ON DELETE CASCADE from portfolio_positions
    DELETE FROM portfolio_positions
    WHERE investment_account_id IN (
        SELECT id FROM bank_accounts
        WHERE owner_type = 'family' AND owner_family_id = _family_id
    );

    -- 10. External connections referencing family accounts / family ownership — no CASCADE
    DELETE FROM external_connections
    WHERE owner_type = 'family'
      AND owner_family_id = _family_id;

    -- 11. Bank accounts (cascades current_bank_balances)
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
