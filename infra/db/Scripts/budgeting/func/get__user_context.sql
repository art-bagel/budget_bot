-- Description:
--   Returns the startup context of an existing account: primary cash account,
--   system categories and interface settings.
--
--   Форма ответа совпадает с put__register_user_context, но эта функция ничего
--   не создает: она для входа в уже существующий аккаунт, где базовая валюта
--   выбрана давно и передавать ее снаружи нечем.
-- Parameters:
--   _user_id bigint - Account identifier.
-- Returns:
--   jsonb - Startup context, or NULL when the account does not exist.
DROP FUNCTION IF EXISTS budgeting.get__user_context;
CREATE FUNCTION budgeting.get__user_context(
    _user_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT jsonb_build_object(
        'status', 'exists',
        'user_id', u.id,
        'bank_account_id', (
            SELECT ba.id
            FROM budgeting.bank_accounts ba
            WHERE ba.owner_type = 'user'
              AND ba.owner_user_id = u.id
              AND ba.account_kind = 'cash'
              AND ba.is_active
            ORDER BY ba.is_primary DESC, ba.id
            LIMIT 1
        ),
        'unallocated_category_id', budgeting.get__owner_system_category_id('user', u.id, NULL, 'Unallocated'),
        'fx_result_category_id', budgeting.get__owner_system_category_id('user', u.id, NULL, 'FX Result'),
        'base_currency_code', u.base_currency_code,
        'hints_enabled', u.hints_enabled,
        'theme', u.theme
    )
    FROM budgeting.users u
    WHERE u.id = _user_id
$function$;
