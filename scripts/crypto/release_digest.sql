-- Read-only content digest of a release database: every table of budgeting and
-- crypto_migration_audit, plus SQL functions, triggers and sequences.
-- Run with `psql -At -f`; identical output means identical databases. Works the
-- same locally and inside the production container, without creating objects.
SET default_transaction_read_only = on;
SELECT format(
    'SELECT %L, count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',
    table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_schema IN ('budgeting', 'crypto_migration_audit') AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name
\gexec
SELECT '_functions', count(*), md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(p.prosrc), ','
    ORDER BY p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'budgeting';
SELECT '_triggers', count(*), md5(string_agg(t.tgrelid::regclass::text || t.tgname || pg_get_triggerdef(t.oid), ','
    ORDER BY t.tgrelid::regclass::text || t.tgname))
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'budgeting' AND NOT t.tgisinternal;
SELECT '_sequences', count(*), md5(string_agg(sequencename || ':' || coalesce(last_value::text, ''), ',' ORDER BY sequencename))
FROM pg_sequences WHERE schemaname = 'budgeting';
