-- Shared dispatcher: invoke the ordinary bank functions under journal capture,
-- retaining their ownership, balance, FIFO and category validation.
CREATE OR REPLACE FUNCTION budgeting.put__execute_bank_journal_command(
 _user_id bigint,_anchor_account_id bigint,_kind text,p jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a record; c record; k text; allowed text[]; required text[]; n numeric; day date; op bigint;
BEGIN
 SET search_path TO budgeting;
 IF NULLIF(current_setting('budgeting.crypto_source_event_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Bank command requires journal capture';
 END IF;
 SELECT * INTO a FROM bank_accounts WHERE id=_anchor_account_id;
 CASE _kind
 WHEN 'bank_asset_merge' THEN required:=ARRAY['bank_account_id','from_crypto_asset_id','to_crypto_asset_id','operated_at'];
 WHEN 'bank_swap' THEN required:=ARRAY['bank_account_id','from_crypto_asset_id','from_quantity','to_crypto_asset_id','to_quantity','operated_at'];
 WHEN 'bank_expense' THEN required:=ARRAY['bank_account_id','category_id','amount','currency_code','operated_at'];
 WHEN 'bank_crypto_expense' THEN required:=ARRAY['bank_account_id','category_id','amount','crypto_asset_id','operated_at'];
 WHEN 'bank_purchase' THEN required:=ARRAY['bank_account_id','fiat_currency_code','fiat_amount','crypto_asset_id','quantity','operated_at'];
 WHEN 'bank_settle_sale' THEN required:=ARRAY['investment_account_id','sale_event_id','category_id','operated_at'];
 WHEN 'budget_allocate' THEN required:=ARRAY['from_category_id','to_category_id','amount','operated_at'];
 ELSE RAISE EXCEPTION 'Unsupported bank journal command';
 END CASE;
 allowed:=required||ARRAY['comment'];
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& required
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) x WHERE NOT x=ANY(allowed))
  OR EXISTS(SELECT 1 FROM unnest(required) x WHERE p->>x IS NULL) THEN
  RAISE EXCEPTION 'Invalid bank journal arguments';
 END IF;
 FOREACH k IN ARRAY ARRAY['currency_code','fiat_currency_code'] LOOP
  IF p ? k AND NOT EXISTS(SELECT 1 FROM currencies WHERE code::text=p->>k) THEN
   RAISE EXCEPTION 'Unknown fiat currency';
  END IF;
 END LOOP;
 day:=(p->>'operated_at')::date;
 IF NOT isfinite(day) THEN RAISE EXCEPTION 'Некорректная дата операции'; END IF;
 FOREACH k IN ARRAY ARRAY['bank_account_id','investment_account_id','category_id','from_category_id','to_category_id'] LOOP
  IF NOT p ? k THEN CONTINUE; END IF;
  IF k IN ('bank_account_id','investment_account_id') THEN
   SELECT owner_type,owner_user_id,owner_family_id INTO c FROM bank_accounts WHERE id=(p->>k)::bigint;
  ELSE
   SELECT owner_type,owner_user_id,owner_family_id INTO c FROM categories WHERE id=(p->>k)::bigint;
  END IF;
  IF c.owner_type IS DISTINCT FROM a.owner_type OR c.owner_user_id IS DISTINCT FROM a.owner_user_id
   OR c.owner_family_id IS DISTINCT FROM a.owner_family_id THEN
   RAISE EXCEPTION 'Bank command resource is outside source journal owner scope';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['amount','fiat_amount','quantity','from_quantity','to_quantity'] LOOP
  IF NOT p ? k THEN CONTINUE; END IF;
  n:=(p->>k)::numeric;
  IF n IS NULL OR n<=0 OR n::text IN ('NaN','Infinity','-Infinity')
   OR n<>round(n,CASE WHEN k IN ('quantity','from_quantity','to_quantity') OR _kind='bank_crypto_expense' THEN 18
    WHEN _kind='budget_allocate' THEN 2 ELSE 8 END) THEN
   RAISE EXCEPTION 'Bank amount must be positive, finite and exact';
  END IF;
 END LOOP;
 CASE _kind
 WHEN 'bank_asset_merge' THEN
  RETURN put__merge_bank_crypto_asset(_user_id,(p->>'bank_account_id')::bigint,(p->>'from_crypto_asset_id')::bigint,(p->>'to_crypto_asset_id')::bigint,day);
 WHEN 'bank_swap' THEN
  RETURN put__swap_bank_crypto_asset(_user_id,(p->>'bank_account_id')::bigint,(p->>'from_crypto_asset_id')::bigint,
   (p->>'from_quantity')::numeric,(p->>'to_crypto_asset_id')::bigint,(p->>'to_quantity')::numeric,p->>'comment',day);
 WHEN 'bank_expense' THEN
  RETURN put__record_expense(_user_id,(p->>'bank_account_id')::bigint,(p->>'category_id')::bigint,
   (p->>'amount')::numeric,(p->>'currency_code')::char(3),p->>'comment',day);
 WHEN 'bank_crypto_expense' THEN
  RETURN put__record_crypto_expense(_user_id,(p->>'bank_account_id')::bigint,(p->>'category_id')::bigint,
   (p->>'crypto_asset_id')::bigint,(p->>'amount')::numeric,p->>'comment',day);
 WHEN 'bank_purchase' THEN
  RETURN put__buy_crypto_asset(_user_id,(p->>'bank_account_id')::bigint,(p->>'fiat_currency_code')::char(3),
   (p->>'fiat_amount')::numeric,(p->>'crypto_asset_id')::bigint,(p->>'quantity')::numeric,p->>'comment',day);
 WHEN 'bank_settle_sale' THEN
  RETURN put__settle_crypto_fiat_sale(_user_id,(p->>'investment_account_id')::bigint,(p->>'sale_event_id')::bigint,
   (p->>'category_id')::bigint,p->>'comment',day);
 WHEN 'budget_allocate' THEN
  op:=put__allocate_budget(_user_id,(p->>'from_category_id')::bigint,(p->>'to_category_id')::bigint,
   (p->>'amount')::numeric,p->>'comment');
  UPDATE operations SET operated_on=day WHERE id=op;
  RETURN jsonb_build_object('operation_id',op);
 END CASE;
END $f$;
