DROP FUNCTION IF EXISTS budgeting.get__crypto_protocol_positions;
CREATE FUNCTION budgeting.get__crypto_protocol_positions(
    _user_id bigint,
    _investment_account_id bigint DEFAULT NULL,
    _status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    _family_id bigint;
    _result jsonb;
BEGIN
    SET search_path TO budgeting;

    _family_id := budgeting.get__user_family_id(_user_id);

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', cpp.id,
                'investment_account_id', cpp.investment_account_id,
                'investment_account_name', ba.name,
                'owner_type', cpp.owner_type,
                'crypto_asset_id', cpp.crypto_asset_id,
                'protocol_name', cpp.protocol_name,
                'position_type', cpp.position_type,
                'status', cpp.status,
                'network_code', cpp.network_code,
                'asset_symbol', cpp.asset_symbol,
                'quantity', cpp.quantity,
                'cost_basis_in_base', cpp.cost_basis_in_base,
                'current_quantity', cpp.current_quantity,
                'current_value_in_base', cpp.current_value_in_base,
                'rewards_claimed_in_base', cpp.rewards_claimed_in_base,
                'rewards_unclaimed_in_base', cpp.rewards_unclaimed_in_base,
                'deposited_at', cpp.deposited_at,
                'withdrawn_at', cpp.withdrawn_at,
                'comment', cpp.comment,
                'metadata', cpp.metadata,
                'created_by_user_id', cpp.created_by_user_id,
                'created_at', cpp.created_at,
                'updated_at', cpp.updated_at
            )
            ORDER BY cpp.status, cpp.deposited_at DESC, cpp.id DESC
        ),
        '[]'::jsonb
    )
    INTO _result
    FROM crypto_protocol_positions cpp
    JOIN bank_accounts ba
      ON ba.id = cpp.investment_account_id
    WHERE (_investment_account_id IS NULL OR cpp.investment_account_id = _investment_account_id)
      AND (_status IS NULL OR cpp.status = _status)
      AND (
            (cpp.owner_type = 'user' AND cpp.owner_user_id = _user_id)
            OR
            (cpp.owner_type = 'family' AND cpp.owner_family_id = _family_id)
          );

    RETURN _result;
END
$function$;

