-- Description:
--   Deletes an active investment account only while it is completely empty.
DROP FUNCTION IF EXISTS budgeting.set__delete_investment_account;
CREATE FUNCTION budgeting.set__delete_investment_account(
    _user_id          bigint,
    _bank_account_id  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account_name       text;
    _owner_type         text;
    _owner_user_id      bigint;
    _owner_family_id    bigint;
    _account_kind       text;
    _blocking_count     bigint;
BEGIN
    SET search_path TO budgeting;

    SELECT name, owner_type, owner_user_id, owner_family_id, account_kind
    INTO _account_name, _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _bank_account_id
      AND is_active
    FOR UPDATE;

    IF _account_name IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _bank_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _bank_account_id;
    END IF;

    IF _account_kind <> 'investment' THEN
        RAISE EXCEPTION 'Only investment accounts can be deleted this way';
    END IF;

    SELECT COUNT(*)
    INTO _blocking_count
    FROM current_bank_balances
    WHERE bank_account_id = _bank_account_id
      AND (amount <> 0 OR historical_cost_in_base <> 0);

    IF _blocking_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete investment account: account still has money';
    END IF;

    SELECT COUNT(*)
    INTO _blocking_count
    FROM portfolio_positions
    WHERE investment_account_id = _bank_account_id;

    IF _blocking_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete investment account: account has portfolio positions';
    END IF;

    SELECT COUNT(*)
    INTO _blocking_count
    FROM bank_entries
    WHERE bank_account_id = _bank_account_id;

    IF _blocking_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete investment account: account has bank operations';
    END IF;

    SELECT COUNT(*)
    INTO _blocking_count
    FROM fx_lots
    WHERE bank_account_id = _bank_account_id;

    IF _blocking_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete investment account: account has FX lots';
    END IF;

    IF to_regclass('budgeting.external_connections') IS NOT NULL THEN
        SELECT COUNT(*)
        INTO _blocking_count
        FROM external_connections
        WHERE linked_account_id = _bank_account_id
          AND is_active;

        IF _blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot delete investment account: account is linked to an external connection';
        END IF;

        UPDATE external_connections
        SET linked_account_id = NULL
        WHERE linked_account_id = _bank_account_id
          AND NOT is_active;
    END IF;

    IF to_regclass('budgeting.tinkoff_api_debug_snapshots') IS NOT NULL THEN
        UPDATE tinkoff_api_debug_snapshots
        SET linked_account_id = NULL
        WHERE linked_account_id = _bank_account_id;
    END IF;

    IF to_regclass('budgeting.tinkoff_api_debug_items') IS NOT NULL THEN
        UPDATE tinkoff_api_debug_items
        SET linked_account_id = NULL
        WHERE linked_account_id = _bank_account_id;
    END IF;

    DELETE FROM bank_accounts
    WHERE id = _bank_account_id;

    RETURN jsonb_build_object(
        'bank_account_id', _bank_account_id,
        'name',            _account_name,
        'status',          'deleted'
    );
END
$function$;
