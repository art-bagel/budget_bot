DROP FUNCTION IF EXISTS budgeting.get__credit_payment_schedule_events;
CREATE FUNCTION budgeting.get__credit_payment_schedule_events(
    _user_id bigint,
    _credit_account_id bigint,
    _as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _effective_as_of date := COALESCE(_as_of, CURRENT_DATE);
    _owner_type text;
    _owner_user_id bigint;
    _owner_family_id bigint;
    _account_kind text;
BEGIN
    SET search_path TO budgeting;

    SELECT owner_type, owner_user_id, owner_family_id, account_kind
    INTO _owner_type, _owner_user_id, _owner_family_id, _account_kind
    FROM bank_accounts
    WHERE id = _credit_account_id
      AND is_active;

    IF _owner_type IS NULL THEN
        RAISE EXCEPTION 'Unknown active bank account %', _credit_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _owner_type, _owner_user_id, _owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to bank account %', _credit_account_id;
    END IF;

    IF _account_kind <> 'credit' THEN
        RAISE EXCEPTION 'Bank account % is not a credit account', _credit_account_id;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'operation_id', cpe.operation_id,
                'scheduled_date', cpe.payment_at::date,
                'total_payment', cpe.payment_amount,
                'principal_component', cpe.principal_paid,
                'interest_component', cpe.interest_paid,
                'principal_before', cpe.principal_before,
                'principal_after', cpe.principal_after,
                'status', 'paid'
            )
            ORDER BY cpe.payment_at, cpe.id
        )
        FROM credit_payment_events cpe
        WHERE cpe.credit_account_id = _credit_account_id
          AND cpe.payment_at::date <= _effective_as_of
    ), '[]'::jsonb);
END
$function$;
