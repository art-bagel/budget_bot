-- Coins on a collection account live like bank coins: they arrive from a crypto
-- account and leave to one through the journal without budget entries, pay for
-- items and come back from item sales with the cost carried. Self-contained, rolled back.
BEGIN;
SET search_path TO budgeting;
DO $$
DECLARE
    uid bigint := 990000000902;
    me jsonb; bank bigint; free bigint; wallet bigint; coll bigint; misc bigint; coin bigint;
    request uuid := gen_random_uuid(); payload jsonb; source_id bigint; preview jsonb; pos bigint; item jsonb; sold jsonb; r jsonb; err text; free_before numeric; op bigint;
BEGIN
    me := put__register_user_context(uid, 'RUB', NULL, 'Coins', 'Owner');
    bank := (me->>'bank_account_id')::bigint;
    free := (me->>'unallocated_category_id')::bigint;
    wallet := (put__create_bank_account(uid, 'Кошелёк', 'user', 'investment', 'crypto')->>'id')::bigint;
    coll := (put__create_bank_account(uid, 'Коллекции', 'user', 'investment', 'collectible')->>'id')::bigint;
    misc := (put__create_bank_account(uid, 'Разное', 'user', 'investment', 'other')->>'id')::bigint;
    coin := (put__ensure_crypto_asset('TGRAM', 'Collection coin', 'ton', '0:collection-coin', 9::smallint, '{}'::jsonb)->>'id')::bigint;

    PERFORM put__record_income(uid, bank, 50000, 'RUB');
    PERFORM put__buy_crypto_asset(uid, bank, 'RUB', 10000, coin, 100);   -- 100 per coin
    PERFORM put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_to_portfolio', jsonb_build_object(
        'bank_account_id', bank, 'investment_account_id', wallet, 'crypto_asset_id', coin, 'amount', '100'));
    pos := (SELECT id FROM portfolio_positions WHERE investment_account_id = wallet AND status = 'open');
    free_before := (SELECT amount FROM current_budget_balances WHERE category_id = free);

    -- 1. Crypto account -> collection account: coins arrive at cost, the budget is untouched.
    r := put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_withdraw', jsonb_build_object(
        'position_id', pos, 'bank_account_id', coll, 'amount', '60'));
    op := (r->>'operation_id')::bigint;
    ASSERT (SELECT (amount, cost_base_remaining) = (60::numeric, 6000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection holds 60 at 6000';
    ASSERT NOT EXISTS (SELECT 1 FROM budget_entries WHERE operation_id = op), 'no budget entries for the move';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = free_before, 'free budget unchanged';
    ASSERT (SELECT quantity FROM portfolio_positions WHERE id = pos) = 40, 'wallet keeps 40';

    SELECT id INTO source_id FROM crypto_source_events WHERE created_by_user_id=uid AND commands->0->>'kind'='bank_withdraw' ORDER BY id DESC LIMIT 1;

    -- 2. Buy an item with 25 coins: the coins' FIFO cost becomes the item's cost.
    payload := jsonb_build_object('investment_account_id',coll,'crypto_asset_id',coin,'crypto_quantity','25',
        'title','Plush Pepe #7','quantity','1','metadata','{"item_kind":"telegram_gift","item_attributes":{"number":"7"},"amount_in_base":1}'::jsonb);
    item := put__manual_collectible_movement(uid,request,'collectible_buy',payload,current_date);
    ASSERT put__manual_collectible_movement(uid,request,'collectible_buy',payload,current_date)=item, 'retry returns same item';
    ASSERT (SELECT count(*) FROM portfolio_positions WHERE investment_account_id=coll)=1, 'retry has no duplicate';
    ASSERT (item->>'amount_in_currency')::numeric = 2500 AND (item->'metadata'->>'amount_in_base')::numeric = 2500,
        format('item cost 2500, got %s', item);
    ASSERT item->'metadata'->'paid_crypto'->>'quantity' = '25', 'paid coins recorded';
    ASSERT (SELECT (amount, cost_base_remaining) = (35::numeric, 3500::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection coins 35 at 3500';

    -- 3. Not more coins than the account holds.
    err := '';
    BEGIN
        PERFORM put__buy_collectible_with_crypto(uid, coll, coin, 36, 'Too much', 1, current_date, NULL, '{"item_kind": "other"}');
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE 'Сумма превышает остаток%', format('overspend rejected, got "%s"', err);

    -- 4. Sell the item for 30 coins: the item's cost carries into the new lot, no result.
    payload := jsonb_build_object('position_id',item->'id','crypto_asset_id',coin,'crypto_quantity','30');
    request := gen_random_uuid();
    sold := put__manual_collectible_movement(uid,request,'collectible_sell',payload,current_date);
    ASSERT put__manual_collectible_movement(uid,request,'collectible_sell',payload,current_date)=sold, 'sale retry returns same result';
    ASSERT sold->>'status' = 'closed' AND (sold->'metadata'->>'realized_result_in_base')::numeric = 0, 'sold at carried cost';
    ASSERT sold->'metadata'->'sold_for_crypto'->>'quantity' = '30', 'received coins recorded';
    ASSERT (SELECT (amount, cost_base_remaining) = (65::numeric, 6000::numeric) FROM current_crypto_balances
            WHERE bank_account_id = coll AND crypto_asset_id = coin), 'collection coins 65 at 6000';

    -- 5. Collection account -> crypto account through the journal, no budget entries.
    r := put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_to_portfolio', jsonb_build_object(
        'bank_account_id', coll, 'investment_account_id', wallet, 'crypto_asset_id', coin, 'amount', '65'));
    op := (r->>'operation_id')::bigint;
    ASSERT NOT EXISTS (SELECT 1 FROM budget_entries WHERE operation_id = op), 'no budget entries for the way back';
    ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id = coll AND crypto_asset_id = coin), 0) = 0,
        'collection coins moved out';
    ASSERT (SELECT quantity FROM portfolio_positions WHERE id = pos) = 105, 'wallet 40 + 65';
    ASSERT (SELECT amount FROM current_budget_balances WHERE category_id = free) = free_before, 'free budget still unchanged';

    -- Correction traverses the item and its coin lots, preserving identities.
    request := gen_random_uuid();
    preview := put__correct_crypto_source(uid,source_id,1,request,
        '[{"command_index":0,"field":"quantity","value":"61"}]','Transfer correction',false,NULL);
    ASSERT NOT (preview->>'applied')::boolean, 'preview rolls back';
    PERFORM put__correct_crypto_source(uid,source_id,1,request,
        '[{"command_index":0,"field":"quantity","value":"61"}]','Transfer correction',true,preview->>'preview_token');
    ASSERT (SELECT quantity FROM portfolio_positions WHERE id=pos)=104, 'wallet after correction';
    ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=coin)=1, 'collection after correction';
    ASSERT (SELECT count(*) FROM portfolio_positions WHERE investment_account_id=coll)=1, 'replay preserves item identity';

    -- 6. Only collection accounts hold coins outside the bank.
    err := '';
    BEGIN
        PERFORM put__manual_crypto_movement(uid, gen_random_uuid(), 'bank_withdraw', jsonb_build_object(
            'position_id', pos, 'bank_account_id', misc, 'amount', '1'));
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err LIKE 'Target account must be a cash or collection account%', format('other account rejected, got "%s"', err);
    err := '';
    BEGIN
        PERFORM put__buy_collectible_with_crypto(uid, misc, coin, 1, 'Wrong', 1, current_date, NULL, '{"item_kind": "other"}');
    EXCEPTION WHEN raise_exception THEN err := SQLERRM;
    END;
    ASSERT err = 'Нет доступа к счёту коллекций', format('item only on collections, got "%s"', err);

    -- 7. Lots equal the projection.
    ASSERT NOT EXISTS (
        SELECT 1 FROM current_crypto_balances b
        JOIN LATERAL (SELECT sum(amount_remaining) q, sum(cost_base_remaining) c FROM crypto_lots l
                      WHERE l.bank_account_id = b.bank_account_id AND l.crypto_asset_id = b.crypto_asset_id) l ON true
        WHERE b.bank_account_id IN (bank, coll) AND (b.amount, b.cost_base_remaining) IS DISTINCT FROM (l.q, l.c)
    ), 'lots match balances';
END $$;
-- A non-chain unit follows the same path: wallet swap, collection purchase,
-- improvement and personal consumption through a bank category. No fake RUB sale.
DO $$
DECLARE uid bigint:=990000000916; me jsonb; bank bigint; wallet bigint; coll bigint;
 ton bigint; stars bigint; pos bigint; starpos bigint; category bigint; item jsonb; budget_before numeric; aitem jsonb; bitem jsonb; req uuid; payload jsonb; result jsonb; err text; allocation_source bigint; preview jsonb;
BEGIN
 me:=put__register_user_context(uid,'RUB',NULL,'Custom unit','Owner');
 bank:=(me->>'bank_account_id')::bigint;
 wallet:=(put__create_bank_account(uid,'Telegram test','user','investment','crypto')->>'id')::bigint;
 coll:=(put__create_bank_account(uid,'Items test','user','investment','collectible')->>'id')::bigint;
 category:=put__create_category(uid,'Reactions test','regular');
 ton:=(put__ensure_crypto_asset('TESTTON','Test TON','test','stars-flow-ton',9::smallint,'{}')->>'id')::bigint;
 stars:=(put__ensure_crypto_asset('TESTSTARS','Test Stars','test','stars-flow-unit',0::smallint,'{}')->>'id')::bigint;
 PERFORM put__record_income(uid,bank,10000,'RUB');
 PERFORM put__buy_crypto_asset(uid,bank,'RUB',1500,ton,5);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_to_portfolio',jsonb_build_object('bank_account_id',bank,'investment_account_id',wallet,'crypto_asset_id',ton,'amount','5'));
 SELECT id INTO pos FROM portfolio_positions WHERE investment_account_id=wallet AND status='open';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'swap',jsonb_build_object('position_id',pos,'from_amount','5','to_crypto_asset_id',stars,'to_amount','1000','target_investment_account_id',wallet));
 SELECT id INTO starpos FROM portfolio_positions WHERE investment_account_id=wallet AND status='open' AND metadata->>'crypto_asset_id'=stars::text;
 SELECT amount INTO budget_before FROM current_budget_balances WHERE category_id=(me->>'unallocated_category_id')::bigint;
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_withdraw',jsonb_build_object('position_id',starpos,'bank_account_id',coll,'amount','325'));
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_buy',jsonb_build_object('investment_account_id',coll,'crypto_asset_id',stars,'crypto_quantity','300','title','Test gift','quantity','1','metadata','{"item_kind":"telegram_gift"}'::jsonb),current_date);
 PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_topup',jsonb_build_object('position_id',item->'id','crypto_asset_id',stars,'crypto_quantity','25'),current_date);
 ASSERT (SELECT (metadata->>'amount_in_base')::numeric FROM portfolio_positions WHERE id=(item->>'id')::bigint)=487.50,'purchase + upgrade carry 487.50 RUB';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=(me->>'unallocated_category_id')::bigint)=budget_before,'collection actions do not consume budget';
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_withdraw',jsonb_build_object('position_id',starpos,'bank_account_id',bank,'amount','10'));
 PERFORM put__record_crypto_expense(uid,bank,category,stars,10,'Reaction',current_date);
 ASSERT (SELECT quantity FROM portfolio_positions WHERE id=starpos)=665,'unspent Stars stay in Telegram wallet';
 ASSERT (get__crypto_position_movable_entry_summary(starpos)->>'remaining_cost_basis')::numeric=997.50,'wallet keeps 997.50 RUB cost';
 ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id=bank AND crypto_asset_id=stars),0)=0,'bank Stars spent';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=bank AND currency_code='RUB')=8500,'no fictitious RUB sale';
 ASSERT (SELECT amount FROM current_budget_balances WHERE category_id=category)=-15,'personal expense costs 15 RUB';
 ASSERT 487.50+997.50+15=1500,'entire initial basis accounted for';
 -- Allocate the monetary basis of one indivisible unit across three items.
 aitem:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,'title','One free item','quantity','1','metadata','{"item_kind":"other"}'::jsonb),current_date);
 bitem:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,'title','Two free items','quantity','2','metadata','{"item_kind":"other"}'::jsonb),current_date);
 PERFORM put__manual_crypto_movement(uid,gen_random_uuid(),'bank_withdraw',jsonb_build_object('position_id',starpos,'bank_account_id',coll,'amount','3'));
 req:=gen_random_uuid();
 payload:=jsonb_build_object('position_id',aitem->'id','crypto_asset_id',stars,'crypto_quantity','1','allocation_position_ids',jsonb_build_array(aitem->'id',bitem->'id'));
 result:=put__manual_collectible_movement(uid,req,'collectible_coin_topup',payload,current_date);
 ASSERT put__manual_collectible_movement(uid,req,'collectible_coin_topup',payload,current_date)=result,'allocation retry does not charge twice';
 ASSERT (SELECT (metadata->>'amount_in_base')::numeric FROM portfolio_positions WHERE id=(aitem->>'id')::bigint)=0.50,'one item gets one third';
 ASSERT (SELECT (metadata->>'amount_in_base')::numeric FROM portfolio_positions WHERE id=(bitem->>'id')::bigint)=1.00,'two items get two thirds';
 ASSERT (SELECT (amount,cost_base_remaining)=(2::numeric,3::numeric) FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=stars),'one whole Star consumed once';
 err:='';
 BEGIN
   PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_topup',payload||'{"crypto_quantity":"3"}',current_date);
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err='Недостаточно монет на счёте коллекций','overspend allocation rejected';
 err:='';
 BEGIN
   PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_topup',payload||jsonb_build_object('allocation_position_ids',jsonb_build_array(aitem->'id',aitem->'id')),current_date);
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err='Выберите предметы без повторений','duplicate selection rejected';
 ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=stars)=2,'failed allocations leave payment untouched';
 SELECT id INTO allocation_source FROM crypto_source_events WHERE source_id=req::text AND source_namespace='manual-collection-v1';
 req:=gen_random_uuid();
 preview:=put__correct_crypto_source(uid,allocation_source,1,req,'[{"command_index":0,"field":"crypto_quantity","value":"2"}]','Adjust allocated cost',false,NULL);
 ASSERT (SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=stars)=2,'correction preview changes nothing';
 PERFORM put__correct_crypto_source(uid,allocation_source,1,req,'[{"command_index":0,"field":"crypto_quantity","value":"2"}]','Adjust allocated cost',true,preview->>'preview_token');
 ASSERT (SELECT (metadata->>'amount_in_base')::numeric FROM portfolio_positions WHERE id=(aitem->>'id')::bigint)=1,'correction recalculates first item';
 ASSERT (SELECT (metadata->>'amount_in_base')::numeric FROM portfolio_positions WHERE id=(bitem->>'id')::bigint)=2,'correction recalculates other selected items';
 ASSERT (SELECT (amount,cost_base_remaining)=(1::numeric,1.5::numeric) FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=stars),'corrected allocation conserves basis';
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,'title','Unknown purchase','quantity',1,'cost_unknown',true,'metadata','{"item_kind":"other"}'::jsonb),current_date);
 req:=gen_random_uuid();
 payload:=jsonb_build_object('position_id',item->'id','crypto_asset_id',stars,'crypto_quantity','1','resolve_purchase_price',true);
 result:=put__manual_collectible_movement(uid,req,'collectible_coin_topup',payload,current_date);
 ASSERT result#>>'{metadata,acquisition_kind}'='purchase','payment resolves unknown price';
 ASSERT (result#>>'{metadata,amount_in_base}')::numeric=1.5,'resolution uses paid coin cost';
 ASSERT put__manual_collectible_movement(uid,req,'collectible_coin_topup',payload,current_date)=result,'price resolution idempotent';
 ASSERT COALESCE((SELECT amount FROM current_crypto_balances WHERE bank_account_id=coll AND crypto_asset_id=stars),0)=0,'resolution spends exactly once';
 err:='';
 BEGIN
  PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_coin_topup',payload,current_date);
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err='Цена покупки уже известна','second resolution rejected';
 PERFORM put__transfer_between_accounts(uid,bank,coll,'RUB',100);
 item:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',coll,'title','Unknown fiat purchase','quantity',1,'cost_unknown',true,'metadata','{"item_kind":"other"}'::jsonb),current_date);
 result:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_fiat_topup',jsonb_build_object('position_id',item->'id','amount_in_currency',30,'currency_code','RUB','resolve_purchase_price',true),current_date);
 ASSERT result#>>'{metadata,acquisition_kind}'='purchase','fiat resolves price';
 ASSERT (result#>>'{metadata,amount_in_base}')::numeric=30,'fiat purchase cost';
 ASSERT (SELECT amount FROM current_bank_balances WHERE bank_account_id=coll AND currency_code='RUB')=70,'fiat source debited';




END $$;
DO $$
DECLARE uid bigint:=990000000917; a bigint; r jsonb; err text; req uuid:=gen_random_uuid(); payload jsonb;
BEGIN
 PERFORM put__register_user_context(uid,'RUB',NULL,'Unknown','Items');
 a:=(put__create_bank_account(uid,'Items unknown','user','investment','collectible')->>'id')::bigint;
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_receive',jsonb_build_object('investment_account_id',a,'title','Unknown price item','quantity',1,'cost_unknown',true,'metadata','{"item_kind":"other"}'::jsonb),current_date);
 ASSERT r#>>'{metadata,acquisition_kind}'='unknown','unknown purchase is not free';
 payload:=jsonb_build_object('position_id',r->'id','acquired_at','2020-01-02');
 r:=put__manual_collectible_movement(uid,req,'collectible_details',payload,current_date);
 PERFORM set_config('budgeting.crypto_source_event_id',(SELECT id::text FROM crypto_source_events WHERE source_id=req::text AND source_namespace='manual-collection-v1'),true);
 PERFORM put__crypto_funding_components(uid,current_setting('budgeting.crypto_source_event_id')::bigint,0,'collectible_details',payload,'{}'::jsonb,r,current_date);
 PERFORM set_config('budgeting.crypto_source_event_id','',true);
 ASSERT r#>>'{metadata,acquired_at}'='2020-01-02','descriptive acquisition date editable';
 ASSERT (r->>'opened_at')::date=current_date,'posting date unchanged';
 ASSERT put__manual_collectible_movement(uid,req,'collectible_details',payload,current_date)=r,'date retry safe';
 err:='';
 BEGIN
  PERFORM put__close_portfolio_position(uid,(r->>'id')::bigint,1,'RUB');
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err='Сначала уточните цену покупки предмета','unknown basis must not become realised profit';
 ASSERT NOT EXISTS(SELECT 1 FROM bank_entries b JOIN operations o ON o.id=b.operation_id WHERE o.owner_user_id=uid),'inventory-only edits do not invent cash';
 payload:=jsonb_build_object('position_id',r->'id','title','Renamed item','comment','Updated note','acquired_at',NULL,'image_url','https://example.org/item.png');
 r:=put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_details',payload,current_date);
 ASSERT r->>'title'='Renamed item' AND r->>'comment'='Updated note','details edited';
 ASSERT r#>>'{metadata,acquired_at}' IS NULL,'date cleared';
 ASSERT r#>>'{metadata,acquisition_kind}'='unknown','details preserve unknown cost';
 err:='';
 BEGIN
  PERFORM put__manual_collectible_movement(uid,gen_random_uuid(),'collectible_details',jsonb_build_object('position_id',r->'id','amount_in_base',1000),current_date);
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM; END;
 ASSERT err='Недопустимые параметры предмета','descriptive edits cannot inject monetary cost';

END $$;
ROLLBACK;
