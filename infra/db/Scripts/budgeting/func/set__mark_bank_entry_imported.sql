DROP FUNCTION IF EXISTS budgeting.set__mark_bank_entry_imported;
CREATE FUNCTION budgeting.set__mark_bank_entry_imported(
    _operation_id bigint,
    _bank_account_id bigint,
    _currency_code char(3),
    _amount numeric,
    _external_id text,
    _import_source varchar(30)
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    _bank_entry_id bigint;
BEGIN
    SET search_path TO budgeting;

    UPDATE bank_entries
    SET external_id = _external_id,
        import_source = _import_source
    WHERE id = (
        SELECT id
        FROM bank_entries
        WHERE operation_id = _operation_id
          AND bank_account_id = _bank_account_id
          AND currency_code = upper(_currency_code)
          AND amount = _amount
          AND external_id IS NULL
        ORDER BY id DESC
        LIMIT 1
    )
    RETURNING id INTO _bank_entry_id;

    RETURN _bank_entry_id;
END
$function$;
