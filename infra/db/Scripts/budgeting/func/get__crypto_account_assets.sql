DROP FUNCTION IF EXISTS budgeting.get__crypto_account_assets;
CREATE FUNCTION budgeting.get__crypto_account_assets(
    _user_id bigint,
    _investment_account_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account record;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    SELECT *
    INTO _account
    FROM bank_accounts
    WHERE id = _investment_account_id
      AND is_active;

    IF _account.id IS NULL THEN
        RAISE EXCEPTION 'Unknown active investment account %', _investment_account_id;
    END IF;

    IF _account.account_kind <> 'investment' OR _account.investment_asset_type <> 'crypto' THEN
        RAISE EXCEPTION 'Account % is not a crypto investment account', _investment_account_id;
    END IF;

    IF NOT budgeting.has__owner_access(_user_id, _account.owner_type, _account.owner_user_id, _account.owner_family_id) THEN
        RAISE EXCEPTION 'Access denied to investment account %', _investment_account_id;
    END IF;

    SELECT COALESCE(jsonb_agg(item ORDER BY (item ->> 'symbol')), '[]'::jsonb)
    INTO _result
    FROM (
        SELECT jsonb_build_object(
            'crypto_asset_id', ca.id,
            'symbol', ca.symbol,
            'name', ca.name,
            'network_code', ca.network_code,
            'contract_address', ca.contract_address,
            'decimals', ca.decimals,
            'asset_metadata', ca.metadata,
            'position_id', pp.id,
            'quantity', pp.quantity,
            'opened_at', pp.opened_at,
            'total_entry_value_in_base', (s.summary ->> 'total_entry_value_in_base')::numeric,
            'total_consumed_cost_basis', (s.summary ->> 'total_consumed_cost_basis')::numeric,
            'remaining_cost_basis', (s.summary ->> 'remaining_cost_basis')::numeric,
            'avg_cost_per_unit', (s.summary ->> 'avg_cost_per_unit')::numeric,
            'realized_pnl_lifetime_in_base', COALESCE(realized.total, 0),
            'last_event_at', last_event.event_at
        ) AS item
        FROM portfolio_positions pp
        JOIN crypto_assets ca
          ON ca.id = (pp.metadata ->> 'crypto_asset_id')::bigint
        CROSS JOIN LATERAL (
            SELECT budgeting.get__crypto_position_entry_summary(pp.id) AS summary
        ) AS s
        LEFT JOIN LATERAL (
            SELECT SUM((pe.metadata ->> 'realized_in_base')::numeric) AS total
            FROM portfolio_events pe
            WHERE pe.position_id = pp.id
              AND pe.metadata ? 'realized_in_base'
        ) AS realized ON TRUE
        LEFT JOIN LATERAL (
            SELECT MAX(pe.event_at) AS event_at
            FROM portfolio_events pe
            WHERE pe.position_id = pp.id
        ) AS last_event ON TRUE
        WHERE pp.investment_account_id = _investment_account_id
          AND pp.asset_type_code = 'crypto'
          AND pp.status = 'open'
          AND pp.metadata ->> 'crypto_asset_id' ~ '^[0-9]+$'
    ) sub;

    RETURN _result;
END
$function$;
