-- Bank-style cancellation: a cancelled operation stays in the history, marked
-- cancelled; a dry-run check names the reason up front. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
-- Is the operation (or journal event) on the given history page filter?
CREATE FUNCTION pg_temp.listed(_uid bigint,_type text,_asset text,_op bigint,_src bigint) RETURNS jsonb LANGUAGE sql AS $$
 SELECT i FROM jsonb_array_elements(budgeting.get__operations_history(_uid,100,0,_type,_asset)->'items') i
 WHERE (_op IS NOT NULL AND (i->>'operation_id')::bigint=_op) OR (_op IS NULL AND (i->>'source_event_id')::bigint=_src) LIMIT 1 $$;
CREATE FUNCTION pg_temp.filters(_uid bigint,_op bigint,_src bigint) RETURNS text[] LANGUAGE sql AS $$
 SELECT array_agg(f ORDER BY f) FROM (SELECT COALESCE(t,'')||'/'||COALESCE(a,'') f FROM unnest(ARRAY[NULL,'investment','banking']) t,
  unnest(ARRAY[NULL,'crypto','collectible','other','security']) a
  WHERE pg_temp.listed(_uid,t,a,_op,_src) IS NOT NULL) x $$;
DO $$
DECLARE
 uid bigint:=990000000971; other bigint:=990000000972; member bigint:=990000000973;
 me jsonb; bank bigint; wallet bigint; coll bigint; coin bigint; pos bigint; item jsonb; req uuid;
 op bigint; sid bigint; listed_before jsonb; listed_after jsonb; f_before text[]; total_before bigint;
 c jsonb; err text; inc jsonb; exp jsonb; fcoll bigint; cash bigint; cat bigint; deletions bigint; events bigint;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Cancel','Owner');
 PERFORM put__register_user_context(other,'RUB',NULL,'Other','User');
 bank:=(me->>'bank_account_id')::bigint;
 wallet:=(put__create_bank_account(uid,'Wallet','user','investment','crypto')->>'id')::bigint;
 coll:=(put__create_bank_account(uid,'Gifts','user','investment','collectible')->>'id')::bigint;
 coin:=(put__ensure_crypto_asset('CNCL','Cancel coin','ton','0:cancel-coin',9::smallint,'{}'::jsonb)->>'id')::bigint;
 PERFORM put__record_income(uid,bank,100000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',10000,coin,100);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_transfer',
  jsonb_build_object('from_account_id',bank,'to_account_id',coll,'crypto_asset_id',coin,'amount','50'),current_date-10);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,
  'crypto_asset_id',coin,'crypto_quantity','20','title','Candle','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date-5);

 -- 2. A journal sale is cancelled: balances roll back, the row stays, marked cancelled.
 req:=gen_random_uuid();
 PERFORM put__manual_collectible_movement(uid,req,'collectible_fiat_close',
  jsonb_build_object('position_id',item->'id','close_currency_code','RUB','close_amount_in_currency',26),current_date);
 sid:=(SELECT id FROM crypto_source_events WHERE source_id=req::text);
 op:=(SELECT ledger_id FROM crypto_source_event_links WHERE source_event_id=sid AND ledger_table='operations');
 listed_before:=pg_temp.listed(uid,'investment','collectible',op,NULL);
 ASSERT listed_before IS NOT NULL AND NOT (listed_before->>'has_reversal')::boolean,'sale listed';
 f_before:=pg_temp.filters(uid,op,NULL);
 total_before:=(get__operations_history(uid,1,0,'investment',NULL)->>'total_count')::bigint;

 -- 5. The dry-run check changes nothing.
 deletions:=(SELECT count(*) FROM crypto_source_deletions); events:=(SELECT count(*) FROM crypto_source_events);
 c:=get__operation_cancel_check(uid,op,NULL);
 ASSERT (c->>'can_cancel')::boolean AND c->>'reason' IS NULL,'sale can be cancelled: '||c;
 ASSERT (SELECT count(*) FROM crypto_source_deletions)=deletions AND (SELECT count(*) FROM crypto_source_events)=events
  AND EXISTS(SELECT 1 FROM operations WHERE id=op)
  AND (SELECT status FROM portfolio_positions WHERE id=(item->>'id')::bigint)='closed','check left data untouched';
 BEGIN PERFORM get__operation_cancel_check(other,op,NULL); RAISE EXCEPTION 'foreign check passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','foreign check denied: '||err;
 BEGIN PERFORM put__cancel_operation(other,op,NULL); RAISE EXCEPTION 'foreign cancel passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','foreign cancel denied: '||err;

 PERFORM put__cancel_operation(uid,op,NULL);
 ASSERT (SELECT status FROM portfolio_positions WHERE id=(item->>'id')::bigint)='open','item open again';
 ASSERT NOT EXISTS(SELECT 1 FROM operations WHERE id=op),'accounting rows rolled back';
 ASSERT COALESCE((SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB'),0)=0,'no rubles left';
 listed_after:=pg_temp.listed(uid,'investment','collectible',op,NULL);
 ASSERT (listed_after->>'has_reversal')::boolean AND (listed_after->>'is_cancelled')::boolean,'listed as cancelled: '||listed_after;
 ASSERT listed_after->'bank_entries'=listed_before->'bank_entries' AND listed_after->>'operated_at'=listed_before->>'operated_at'
  AND listed_after->>'type'=listed_before->>'type','same amount, date and kind';
 -- 3. Filters, pagination and scope are the same as before the cancel.
 ASSERT pg_temp.filters(uid,op,NULL)=f_before,'same filters: '||f_before::text||' vs '||pg_temp.filters(uid,op,NULL)::text;
 ASSERT pg_temp.listed(uid,'cancelled',NULL,op,NULL) IS NOT NULL,'in the cancelled filter';
 ASSERT (get__operations_history(uid,1,0,'investment',NULL)->>'total_count')::bigint=total_before,'total unchanged';
 ASSERT pg_temp.listed(other,NULL,NULL,op,NULL) IS NULL,'hidden from another user';
 -- 4. No second cancel.
 BEGIN PERFORM put__cancel_operation(uid,op,NULL); RAISE EXCEPTION 'second cancel passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Операция уже отменена','second cancel: '||err;
 BEGIN PERFORM put__reverse_operation(uid,op); RAISE EXCEPTION 'second reverse passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Операция уже отменена','second reverse: '||err;
 BEGIN PERFORM put__cancel_operation(other,op,NULL); RAISE EXCEPTION 'foreign cancelled passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err LIKE 'Нет доступа%','foreign on cancelled: '||err;
 c:=get__operation_cancel_check(uid,op,NULL);
 ASSERT NOT (c->>'can_cancel')::boolean AND c->>'reason'='Операция уже отменена','check on cancelled: '||c;

 -- 5. A later dependent journal operation is named as the reason.
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_sell',
  jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','30'),current_date);
 op:=(SELECT l.ledger_id FROM crypto_source_event_links l JOIN crypto_source_events s ON s.id=l.source_event_id
  WHERE l.ledger_table='operations' AND s.commands->0->>'kind'='collectible_buy');
 c:=get__operation_cancel_check(uid,op,NULL);
 ASSERT NOT (c->>'can_cancel')::boolean AND c->>'reason' LIKE 'Сначала отмените более поздние%','dependent: '||c;

 -- 9. A journal event without an operations row is listed in its asset type and cancelled.
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object(
  'bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',coin,'amount','10'));
 pos:=(SELECT id FROM portfolio_positions WHERE investment_account_id=wallet AND status='open');
 sid:=(put__manual_crypto_movement(uid,gen_random_uuid(),'fee',jsonb_build_object('source_position_id',pos,'quantity','1'))->>'source_event_id')::bigint;
 ASSERT NOT EXISTS(SELECT 1 FROM crypto_source_event_links WHERE source_event_id=sid AND ledger_table='operations'),'fee has no operation';
 listed_before:=pg_temp.listed(uid,'investment','crypto',NULL,sid);
 ASSERT listed_before->>'type'='investment_journal' AND listed_before->>'operation_id' IS NULL
  AND jsonb_array_length(listed_before->'portfolio_events')=1 AND listed_before->'commands'->0->>'kind'='fee','fee listed: '||listed_before;
 f_before:=pg_temp.filters(uid,NULL,sid);
 ASSERT f_before=ARRAY['/','/crypto','investment/','investment/crypto'],'fee only in crypto: '||f_before::text;
 ASSERT (get__operation_cancel_check(uid,NULL,sid)->>'can_cancel')::boolean,'fee can be cancelled';
 PERFORM put__cancel_operation(uid,NULL,sid);
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=pos)=10,'fee rolled back';
 listed_after:=pg_temp.listed(uid,'investment','crypto',NULL,sid);
 ASSERT (listed_after->>'is_cancelled')::boolean AND listed_after->'portfolio_events'=listed_before->'portfolio_events','fee listed as cancelled';
 ASSERT pg_temp.filters(uid,NULL,sid)=f_before,'fee filters kept';
 BEGIN PERFORM put__cancel_operation(uid,NULL,sid); RAISE EXCEPTION 'second fee cancel passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Операция уже отменена','second fee cancel: '||err;
 -- Item parameter edits are not financial operations and are not listed.
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_details',
  jsonb_build_object('position_id',item->'id','title','Candle #2'),current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE created_by_user_id=uid);
 ASSERT (SELECT commands->0->>'kind' FROM crypto_source_events WHERE id=sid)='collectible_details','details posted';
 ASSERT pg_temp.listed(uid,NULL,NULL,NULL,sid) IS NULL,'details not listed';

 -- 5, 6. Bank operations: reason in Russian when the money is spent; reversal keeps the row.
 cash:=(put__create_bank_account(uid,'Cash','user','cash')->>'id')::bigint;
 cat:=put__create_category(uid,'Food','regular');
 inc:=put__record_income(uid,cash,1000,'RUB');
 exp:=put__record_expense(uid,cash,cat,900,'RUB');
 c:=get__operation_cancel_check(uid,(inc->>'operation_id')::bigint,NULL);
 ASSERT NOT (c->>'can_cancel')::boolean AND c->>'reason' LIKE 'Не отменить: на счёте «Cash» не хватает 900%','spent income: '||c;
 ASSERT (get__operation_cancel_check(uid,(exp->>'operation_id')::bigint,NULL)->>'can_cancel')::boolean,'expense can be cancelled';
 PERFORM put__cancel_operation(uid,(exp->>'operation_id')::bigint,NULL);
 ASSERT (pg_temp.listed(uid,NULL,NULL,(exp->>'operation_id')::bigint,NULL)->>'has_reversal')::boolean,'expense listed as cancelled';
 BEGIN PERFORM put__cancel_operation(uid,(exp->>'operation_id')::bigint,NULL); RAISE EXCEPTION 'second reversal passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Операция уже отменена','second reversal: '||err;
 c:=get__operation_cancel_check(uid,(exp->>'operation_id')::bigint,NULL);
 ASSERT c->>'reason'='Операция уже отменена','check on reversed: '||c;
 ASSERT (get__operation_cancel_check(uid,(inc->>'operation_id')::bigint,NULL)->>'can_cancel')::boolean,'income cancellable once money is back';
 BEGIN PERFORM put__cancel_operation(uid,NULL,NULL); RAISE EXCEPTION 'empty cancel passed';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS err=MESSAGE_TEXT; END;
 ASSERT err='Некорректная отмена','empty cancel: '||err;

 -- 3. A family member cancels a family operation; the founder sees it cancelled.
 PERFORM put__register_user_context(member,'RUB','cancel_member','Family','Member');
 PERFORM put__create_family(uid,'Cancel family');
 PERFORM set__respond_family_invitation(member,(put__invite_family_member(uid,'cancel_member')->>'invitation_id')::bigint,true);
 fcoll:=(put__create_bank_account(uid,'Family gifts','family','investment','collectible')->>'id')::bigint;
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',fcoll,
  'title','Family gift','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 sid:=(SELECT max(id) FROM crypto_source_events WHERE anchor_account_id=fcoll);
 op:=(SELECT ledger_id FROM crypto_source_event_links WHERE source_event_id=sid AND ledger_table='operations');
 ASSERT pg_temp.listed(member,'investment','collectible',op,sid) IS NOT NULL,'member sees the family gift';
 PERFORM put__cancel_operation(member,op,CASE WHEN op IS NULL THEN sid END);
 ASSERT NOT EXISTS(SELECT 1 FROM portfolio_positions WHERE investment_account_id=fcoll),'gift rolled back';
 ASSERT (pg_temp.listed(uid,'investment','collectible',op,sid)->>'is_cancelled')::boolean,'founder sees it cancelled';
 ASSERT pg_temp.listed(other,NULL,NULL,op,sid) IS NULL,'outsider does not';
END $$;
ROLLBACK;
