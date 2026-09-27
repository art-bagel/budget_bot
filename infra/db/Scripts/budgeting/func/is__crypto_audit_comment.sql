CREATE OR REPLACE FUNCTION budgeting.is__crypto_audit_comment(
    _ledger_table text, _ledger_id bigint, _comment text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE AS $function$
    SELECT CASE WHEN _comment IS NOT NULL THEN COALESCE((
        -- Editable position notes follow the last writer of this comment,
        -- not the origin of the position. Later manual notes remain visible.
        SELECT (s.evidence->>'comment_origin' = 'audit'
                OR s.source_namespace = 'first-hundred-dev-v1') IS TRUE
        FROM budgeting.crypto_source_mutations m
        JOIN budgeting.crypto_source_events s ON s.id=m.source_event_id
        WHERE m.table_name=_ledger_table AND m.row_key=jsonb_build_object('id',_ledger_id)
          AND m.after_row->>'comment'=_comment
          AND m.after_row->>'comment' IS DISTINCT FROM m.before_row->>'comment'
        ORDER BY m.id DESC LIMIT 1
    ), false) ELSE EXISTS (
        SELECT 1
        FROM budgeting.crypto_source_event_links l
        JOIN budgeting.crypto_source_events s ON s.id = l.source_event_id
        WHERE l.ledger_table = _ledger_table AND l.ledger_id = _ledger_id
          -- New importers declare annotation origin explicitly. The historical
          -- reconstruction predates that field; its comments are audit notes.
          -- Adopted bank history and manual comments remain user-visible.
          AND (s.evidence->>'comment_origin' = 'audit'
               OR s.source_namespace = 'first-hundred-dev-v1')
    ) END;
$function$;
