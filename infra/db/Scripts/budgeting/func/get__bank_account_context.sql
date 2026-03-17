DROP FUNCTION get__bank_account_context(bigint);
CREATE OR REPLACE FUNCTION budgeting.get__bank_account_context(
    _bank_account_id bigint
)
RETURNS TABLE (
    id bigint,
    owner_type text,
    owner_user_id bigint,
    owner_family_id bigint,
    name varchar(100),
    account_kind text,
    provider_name varchar(150),
    provider_account_ref varchar(150),
    is_primary boolean,
    is_active boolean,
    created_at timestamptz
)
LANGUAGE sql
AS $function$
    SELECT
        ba.id,
        ba.owner_type::text,
        ba.owner_user_id,
        ba.owner_family_id,
        ba.name,
        ba.account_kind::text,
        ba.provider_name,
        ba.provider_account_ref,
        ba.is_primary,
        ba.is_active,
        ba.created_at
    FROM budgeting.bank_accounts ba
    WHERE ba.id = _bank_account_id
$function$;
