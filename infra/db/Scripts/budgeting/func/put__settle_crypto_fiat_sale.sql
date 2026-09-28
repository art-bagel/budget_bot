DROP FUNCTION IF EXISTS budgeting.put__settle_crypto_fiat_sale;
CREATE FUNCTION budgeting.put__settle_crypto_fiat_sale(
    _user_id bigint, _investment_account_id bigint, _sale_event_id bigint,
    _category_id bigint, _comment text DEFAULT NULL, _operated_at date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
    _event record; _account record; _bank bigint; _result jsonb; _prior jsonb;
BEGIN
    SET search_path TO budgeting;
    SELECT * INTO _account FROM bank_accounts WHERE id=_investment_account_id;
    IF _account.id IS NULL OR NOT budgeting.has__owner_access(_user_id,
        _account.owner_type,_account.owner_user_id,_account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to sale account';
    END IF;
    SELECT e.* INTO _event FROM portfolio_events e JOIN portfolio_positions p ON p.id=e.position_id
        WHERE e.id=_sale_event_id AND p.investment_account_id=_investment_account_id;
    IF _event.id IS NULL OR _event.metadata->>'action'<>'fiat_sell'
        OR (_event.metadata->>'pending_manual_expense') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Sale is not awaiting manual expense';
    END IF;
    _bank:=(_event.metadata->>'target_bank_account_id')::bigint;
    _prior:=_event.metadata->'manual_expense_settlement';
    IF _prior IS NOT NULL AND (_prior->>'category_id')::bigint=_category_id
        AND (_prior->>'operated_at')::date=COALESCE(_operated_at,current_date)
        AND _prior->>'comment' IS NOT DISTINCT FROM _comment
        AND (_event.currency_code=budgeting.get__owner_base_currency(_account.owner_type,_account.owner_user_id,_account.owner_family_id)
             OR (SELECT COALESCE(sum(amount),0) FROM lot_consumptions
             WHERE operation_id=(_prior#>>'{result,operation_id}')::bigint
               AND lot_id=(_event.metadata->>'fx_lot_id')::bigint)=_event.amount) THEN
        RETURN _prior->'result';
    END IF;
    IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
        RETURN budgeting.put__journal_bank_operation(_user_id,_investment_account_id,'bank_settle_sale',jsonb_build_object(
            'investment_account_id',_investment_account_id,'sale_event_id',_sale_event_id,'category_id',_category_id,
            'comment',_comment,'operated_at',COALESCE(_operated_at,current_date)));
    END IF;
    -- Same order as the sale, followed by the event and money balances.
    PERFORM id FROM bank_accounts WHERE id IN (_investment_account_id,_bank) ORDER BY id FOR UPDATE;
    SELECT * INTO _event FROM portfolio_events WHERE id=_sale_event_id FOR UPDATE;
    _prior:=_event.metadata->'manual_expense_settlement';
    IF _prior IS NOT NULL THEN
        IF (_prior->>'category_id')::bigint IS DISTINCT FROM _category_id
            OR (_prior->>'operated_at')::date IS DISTINCT FROM COALESCE(_operated_at,current_date)
            OR _prior->>'comment' IS DISTINCT FROM _comment THEN
            RAISE EXCEPTION 'Sale already allocated; use historical correction';
        END IF;
        PERFORM budgeting.put__reconcile_linked_fx_expenses(_user_id,_bank,_event.currency_code);
        SELECT metadata#>'{manual_expense_settlement,result}' INTO _result
        FROM portfolio_events WHERE id=_sale_event_id;
        RETURN _result;
    END IF;
    IF COALESCE(_operated_at,current_date)<_event.event_at THEN
        RAISE EXCEPTION 'Expense cannot precede sale';
    END IF;
    _result:=budgeting.put__record_expense(_user_id,_bank,_category_id,
        _event.amount,_event.currency_code,_comment,_operated_at);
    UPDATE portfolio_events SET metadata=metadata||jsonb_build_object('manual_expense_settlement',
        jsonb_build_object('category_id',_category_id,'operated_at',COALESCE(_operated_at,current_date),
            'comment',_comment,'result',_result)) WHERE id=_sale_event_id;
    PERFORM budgeting.put__reconcile_linked_fx_expenses(_user_id,_bank,_event.currency_code);
    SELECT metadata#>'{manual_expense_settlement,result}' INTO _result
    FROM portfolio_events WHERE id=_sale_event_id;
    RETURN _result;
END
$function$;
