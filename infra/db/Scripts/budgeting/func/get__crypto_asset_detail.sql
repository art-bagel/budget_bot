DROP FUNCTION IF EXISTS budgeting.get__crypto_asset_detail;
CREATE FUNCTION budgeting.get__crypto_asset_detail(
    _user_id bigint,
    _investment_account_id bigint,
    _crypto_asset_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _account record;
    _position record;
    _summary jsonb;
    _entries jsonb;
    _realized_total numeric(20, 2);
    _last_event_at date;
    _asset record;
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

    SELECT *
    INTO _position
    FROM portfolio_positions
    WHERE investment_account_id = _investment_account_id
      AND asset_type_code = 'crypto'
      AND status = 'open'
      AND (metadata ->> 'crypto_asset_id')::bigint = _crypto_asset_id
    ORDER BY opened_at, id
    LIMIT 1;

    IF _position.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT *
    INTO _asset
    FROM crypto_assets
    WHERE id = _crypto_asset_id;

    _summary := budgeting.get__crypto_position_entry_summary(_position.id);

    SELECT
        COALESCE(SUM((pe.metadata ->> 'realized_in_base')::numeric), 0),
        MAX(pe.event_at)
    INTO _realized_total, _last_event_at
    FROM portfolio_events pe
    WHERE pe.position_id = _position.id;

    SELECT COALESCE(jsonb_agg(item ORDER BY (item ->> 'event_at') DESC, (item ->> 'event_id')::bigint DESC), '[]'::jsonb)
    INTO _entries
    FROM (
        SELECT jsonb_build_object(
            'event_id', pe.id,
            'event_type', pe.event_type,
            'event_at', pe.event_at,
            'quantity', pe.quantity,
            'amount', pe.amount,
            'currency_code', pe.currency_code,
            'comment', pe.comment,
            'linked_operation_id', pe.linked_operation_id,
            'metadata', pe.metadata,
            'entry_value_in_base',
                CASE WHEN pe.metadata ? 'entry_value_in_base'
                    THEN (pe.metadata ->> 'entry_value_in_base')::numeric
                    ELSE NULL
                END,
            'value_in_base',
                CASE WHEN pe.metadata ? 'value_in_base'
                    THEN (pe.metadata ->> 'value_in_base')::numeric
                    ELSE NULL
                END,
            'consumed_cost_basis',
                CASE WHEN pe.metadata ? 'consumed_cost_basis'
                    THEN (pe.metadata ->> 'consumed_cost_basis')::numeric
                    ELSE NULL
                END,
            'realized_in_base',
                CASE WHEN pe.metadata ? 'realized_in_base'
                    THEN (pe.metadata ->> 'realized_in_base')::numeric
                    ELSE NULL
                END,
            'source_kind', pe.metadata ->> 'source_kind',
            'target_kind', pe.metadata ->> 'target_kind',
            'is_legacy_no_basis', COALESCE((pe.metadata ->> 'legacy_no_basis')::boolean, false)
        ) AS item
        FROM portfolio_events pe
        WHERE pe.position_id = _position.id
    ) sub;

    RETURN jsonb_build_object(
        'crypto_asset_id', _asset.id,
        'symbol', _asset.symbol,
        'name', _asset.name,
        'network_code', _asset.network_code,
        'contract_address', _asset.contract_address,
        'decimals', _asset.decimals,
        'asset_metadata', _asset.metadata,
        'position_id', _position.id,
        'investment_account_id', _position.investment_account_id,
        'investment_account_name', _account.name,
        'quantity', _position.quantity,
        'opened_at', _position.opened_at,
        'total_entry_value_in_base', (_summary ->> 'total_entry_value_in_base')::numeric,
        'total_consumed_cost_basis', (_summary ->> 'total_consumed_cost_basis')::numeric,
        'remaining_cost_basis', (_summary ->> 'remaining_cost_basis')::numeric,
        'avg_cost_per_unit', (_summary ->> 'avg_cost_per_unit')::numeric,
        'realized_pnl_lifetime_in_base', _realized_total,
        'last_event_at', _last_event_at,
        'entries', _entries
    );
END
$function$;
