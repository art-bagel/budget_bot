DROP FUNCTION IF EXISTS budgeting.get__pending_crypto_fiat_expenses;
CREATE FUNCTION budgeting.get__pending_crypto_fiat_expenses(
    _user_id bigint, _limit integer DEFAULT 50, _offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
BEGIN
    IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 200 OR _offset IS NULL OR _offset<0 THEN
        RAISE EXCEPTION 'Invalid pending expense pagination';
    END IF;
    RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.sale_date,x.sale_event_id),'[]'::jsonb)
      FROM (
        SELECT e.id AS sale_event_id,p.investment_account_id,e.event_at AS sale_date,
            e.amount::text AS amount,e.currency_code,b.name AS bank_account_name,
            (e.metadata->>'target_bank_account_id')::bigint AS bank_account_id,
            a.name AS investment_account_name,e.comment,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id),'[]'::jsonb)
             FROM budgeting.categories c WHERE c.is_active AND c.kind='regular'
               AND c.owner_type=a.owner_type AND c.owner_user_id IS NOT DISTINCT FROM a.owner_user_id
               AND c.owner_family_id IS NOT DISTINCT FROM a.owner_family_id) AS categories
        FROM budgeting.portfolio_events e
        JOIN budgeting.portfolio_positions p ON p.id=e.position_id
        JOIN budgeting.bank_accounts a ON a.id=p.investment_account_id
        JOIN budgeting.bank_accounts b ON b.id=(e.metadata->>'target_bank_account_id')::bigint
        WHERE e.metadata->>'action'='fiat_sell' AND e.metadata->>'pending_manual_expense'='true'
          AND NOT (e.metadata ? 'manual_expense_settlement')
          AND budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id)
        ORDER BY e.event_at,e.id LIMIT _limit OFFSET _offset
      ) x);
END
$function$;
