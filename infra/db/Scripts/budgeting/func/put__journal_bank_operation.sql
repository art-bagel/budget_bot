-- Bank FIFO follows posting order. Effective dates remain on the ledger and
-- payload; the envelope timestamp records when the posting joined the journal.
CREATE OR REPLACE FUNCTION budgeting.put__journal_bank_operation(
 _user_id bigint, _anchor_account_id bigint, _kind text, _payload jsonb,
 _request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a record; owner text; prior record; posted timestamptz; seq bigint; result jsonb; effective date;
BEGIN
 SET search_path TO budgeting;
 SELECT * INTO a FROM bank_accounts WHERE id=_anchor_account_id;
 IF a.id IS NULL OR NOT has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
  RAISE EXCEPTION 'Нет доступа к счёту';
 END IF;
 IF _request_id IS NULL OR _kind NOT IN ('bank_expense','bank_crypto_expense','bank_purchase','bank_settle_sale','budget_allocate')
  OR _kind IS NULL OR jsonb_typeof(_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Некорректная банковская операция';
 END IF;
 owner:=a.owner_type||':'||CASE WHEN a.owner_type='user' THEN a.owner_user_id ELSE a.owner_family_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:'||owner,0));
 SELECT * INTO prior FROM crypto_source_events WHERE owner_key=owner
  AND source_namespace='bank-posting-v1' AND source_id=_request_id::text;
 IF prior.id IS NOT NULL THEN
  IF prior.anchor_account_id<>a.id OR prior.evidence IS DISTINCT FROM jsonb_build_object('kind',_kind,'original_payload',_payload) THEN
   RAISE EXCEPTION 'Этот запрос уже проведён с другими данными';
  END IF;
  RETURN (prior.result->'results'->0)||jsonb_build_object('source_event_id',prior.id);
 END IF;
 effective:=(_payload->>'operated_at')::date;
 IF effective IS NULL OR NOT isfinite(effective) THEN RAISE EXCEPTION 'Некорректная дата операции'; END IF;
 -- Late categorisation appends after existing sources while retaining its date.
 SELECT GREATEST((effective::timestamp+interval '1 day'-interval '1 microsecond') AT TIME ZONE 'UTC',max(occurred_at))
 INTO posted FROM crypto_source_events WHERE owner_key=owner;
 SELECT COALESCE(max(order_in_timestamp)+1,0) INTO seq FROM crypto_source_events WHERE owner_key=owner AND occurred_at=posted;
 result:=put__crypto_source_event(_user_id,a.id,'bank-posting-v1',_request_id::text,posted,seq,
  (posted AT TIME ZONE 'UTC')::date,jsonb_build_array(jsonb_build_object('kind',_kind,'payload',_payload)),
  jsonb_build_object('kind',_kind,'original_payload',_payload));
 RETURN (result->'results'->0)||jsonb_build_object('source_event_id',result->'source_event_id');
END $f$;
