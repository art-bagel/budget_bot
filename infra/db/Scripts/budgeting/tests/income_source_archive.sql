-- Archived income sources: hidden from new income, kept in history, restored
-- by creating a source with the same name; other users cannot archive them.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE uid bigint:=990000000951; other bigint:=990000000952; me jsonb; bank bigint;
  src bigint; again bigint; op jsonb; hist jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Arch','Source');
 PERFORM put__register_user_context(other,'RUB',NULL,'Other','User');
 bank:=(me->>'bank_account_id')::bigint;
 src:=put__create_income_source(uid,'Зарплата');
 PERFORM put__upsert_income_source_pattern(uid,src,jsonb_build_array(jsonb_build_object('bank_account_id',bank,'share',1)));
 op:=put__record_income(uid,bank,1000,'RUB',src);

 BEGIN
   PERFORM set__archive_income_source(other,src);
   RAISE EXCEPTION 'Foreign archive test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM LIKE 'Unknown active income source%','foreign source not archived';
 END;
 ASSERT (SELECT is_active FROM income_sources WHERE id=src),'still active after foreign attempt';

 ASSERT (set__archive_income_source(uid,src)->>'is_active')::boolean=false,'archived';
 ASSERT get__income_sources(uid,true)='[]'::jsonb,'not offered among active';
 ASSERT jsonb_array_length(get__income_sources(uid,false))=1,'listed among archived';

 BEGIN
   PERFORM put__record_income(uid,bank,1,'RUB',src);
   RAISE EXCEPTION 'Archived income test failed';
 EXCEPTION WHEN raise_exception THEN
   ASSERT SQLERRM LIKE 'Unknown active income source%','income into archived source rejected';
 END;

 hist:=get__operations_history(uid);
 ASSERT hist::text LIKE '%"income_source_name": "Зарплата"%','history keeps the source name';

 again:=put__create_income_source(uid,' Зарплата ');
 ASSERT again=src,'same name restores the archived source';
 ASSERT (SELECT is_active FROM income_sources WHERE id=src),'restored as active';
 ASSERT (SELECT count(*) FROM income_source_patterns WHERE income_source_id=src)=1,'pattern kept';
 PERFORM put__record_income(uid,bank,1,'RUB',src);
END $$;
ROLLBACK;
