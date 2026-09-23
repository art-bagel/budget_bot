"""Bank exchange and portfolio transfer via the journal, disposable dev only."""
import asyncio
from decimal import Decimal
from datetime import date, timedelta
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
assert sys.argv[3].startswith('boundary_')
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(socket),
    DB_PORT=sys.argv[2], DB_DATABASE=sys.argv[3], DB_SCHEMA='budgeting', POSTGRES_USER='audit', POSTGRES_PASSWORD='', TELEGRAM_BOT_TOKEN='')

import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    pool = await crypto.ledger._get_pool()

    async def sql(q, *args):
        async with pool.acquire() as db:
            return await db.fetchval(q, *args)

    try:
        uid = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
        other = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
        await sql("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system') RETURNING id", uid)
        bank = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'BANK JOURNAL TEST') RETURNING id", uid)
        foreign = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'OTHER OWNER') RETURNING id", other)
        inv = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,'JOURNAL TARGET','investment','crypto') RETURNING id", uid)
        asset = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('BANKTEST','Bank journal test','testnet',$1,18) RETURNING id", str(uid))
        await sql("SELECT budgeting.put__record_income($1,$2,100,'RUB')", uid, bank)
        app = FastAPI()
        app.include_router(crypto.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({'detail': str(exc)}, status_code=400)

        def event(n, commands):
            return dict(anchor_account_id=inv, source_namespace='bank-journal-test', source_id=str(n),
                occurred_at=f'{date(2024,1,1)+timedelta(days=n-1)}T12:00:00Z', accounting_date=str(date(2024,1,1)+timedelta(days=n-1)), order_in_timestamp=0, commands=commands)

        buy = dict(kind='bank_buy', payload=dict(bank_account_id=bank, crypto_asset_id=asset,
            quantity='1.000000000000000001', fiat_currency_code='RUB', fiat_amount='10.00'))
        transfer = dict(kind='bank_to_portfolio', payload=dict(bank_account_id=bank, investment_account_id=inv,
            crypto_asset_id=asset, quantity='1.000000000000000001'))
        snapshot = """SELECT jsonb_build_object(
            'cash',(SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'),
            'crypto',(SELECT jsonb_agg(to_jsonb(c)) FROM budgeting.current_crypto_balances c WHERE bank_account_id=$1),
            'ops',(SELECT count(*) FROM budgeting.operations WHERE owner_user_id=$2),
            'events',(SELECT count(*) FROM budgeting.crypto_source_events WHERE created_by_user_id=$2),
            'lots',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM budgeting.crypto_lots l WHERE bank_account_id=$1))"""
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/crypto/source-events', json=event(1, [buy]))
            assert response.status_code == 200, response.text
            first = response.json()
            assert await sql('SELECT amount FROM budgeting.current_crypto_balances WHERE bank_account_id=$1 AND crypto_asset_id=$2', bank, asset) == Decimal('1.000000000000000001')
            assert await sql('SELECT count(*) FROM budgeting.portfolio_positions WHERE investment_account_id=$1', inv) == 0
            assert await sql("SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'", bank) == 90
            before = await sql(snapshot, bank, uid)
            response = await client.post('/api/v1/crypto/source-events', json=event(1, [buy]))
            assert response.status_code == 200 and response.json() == first
            assert before == await sql(snapshot, bank, uid)
            response = await client.post('/api/v1/crypto/source-events', json=event(2, [transfer]))
            assert response.status_code == 200, response.text
            pos = response.json()['results'][0]['position_id']
            assert await sql('SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1', pos) == Decimal('1.000000000000000001')
            summary = await sql('SELECT budgeting.get__crypto_position_entry_summary($1)', pos)
            assert summary['remaining_cost_basis'] == 10 and summary['basis_quality'] == 'known'
            assert await sql('SELECT COALESCE(sum(amount),0) FROM budgeting.current_crypto_balances WHERE bank_account_id=$1', bank) == 0
            before = await sql(snapshot, bank, uid)
            bad_transfer = dict(kind='bank_to_portfolio', payload={**transfer['payload'], 'quantity': '2'})
            response = await client.post('/api/v1/crypto/source-events', json=event(3, [buy, bad_transfer]))
            assert response.status_code == 400
            assert before == await sql(snapshot, bank, uid), 'Failed batch must roll back purchase too'
            for patch in [{'bank_account_id': foreign}, {'fiat_currency_code': 'USD'}, {'fiat_amount': 'NaN'},
                          {'fiat_amount': '1.001'}, {'quantity': '0'}, {'quantity': '0.0000000000000000001'},
                          {'purchase_quality': 'estimated'}]:
                response = await client.post('/api/v1/crypto/source-events', json=event(3, [dict(kind='bank_buy', payload={**buy['payload'], **patch})]))
                assert response.status_code in (400, 422), (patch, response.text)
                assert before == await sql(snapshot, bank, uid)
            response = await client.post('/api/v1/crypto/source-events', json=event(3, [buy, transfer]))
            assert response.status_code == 200, response.text
            result = response.json()
            before = await sql(snapshot, bank, uid)
            repeat = await client.post('/api/v1/crypto/source-events', json=event(3, [buy, transfer]))
            assert repeat.json() == result and before == await sql(snapshot, bank, uid)
            receipt = dict(master='0:' + 'a'*64, quantity='0.5', custody='main')
            create = dict(kind='create_protocol', payload=dict(investment_account_id=inv, protocol_name='TEST LP',
                position_type='liquidity_pool', asset_symbol='BANKTEST', quantity='1', source_position_id=pos,
                crypto_asset_id=asset, metadata={'lp_receipt': receipt}))
            response = await client.post('/api/v1/crypto/source-events', json=event(4, [create]))
            assert response.status_code == 200, response.text
            protocol_id = response.json()['results'][0]['id']
            custody = dict(kind='lp_custody', payload=dict(position_id=protocol_id, receipt_master=receipt['master'],
                quantity='0.5', from_custody='main', to_custody='0:' + 'b'*64))
            protocol_query = 'SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1'
            before = await sql(protocol_query, protocol_id)
            fail_fee = dict(kind='fee', payload=dict(source_position_id=pos, quantity='100'))
            response = await client.post('/api/v1/crypto/source-events', json=event(5, [custody, fail_fee]))
            assert response.status_code == 400
            assert before == await sql(protocol_query, protocol_id), 'Custody must roll back with fee failure'
            for patch in [{'quantity':'0.1'}, {'from_custody':'wrong'}, {'receipt_master':'0:'+'c'*64},
                          {'to_custody':'main'}, {'to_custody':'arbitrary'}, {'cost_basis_in_base':'0'}]:
                response = await client.post('/api/v1/crypto/source-events', json=event(5,[dict(kind='lp_custody',payload={**custody['payload'],**patch})]))
                assert response.status_code == 400, (patch,response.text)
                assert before == await sql(protocol_query,protocol_id)
            response = await client.post('/api/v1/crypto/source-events', json=event(5,[custody]))
            assert response.status_code == 200, response.text
            after = await sql(protocol_query,protocol_id)
            assert after['metadata']['lp_receipt']['custody'] == '0:'+'b'*64
            for key in ('cost_basis_in_base','quantity','current_quantity','current_value_in_base','rewards_claimed_in_base'):
                assert after[key] == before[key], key
            repeat = await client.post('/api/v1/crypto/source-events', json=event(5,[custody]))
            assert repeat.status_code == 200 and repeat.json()==response.json()
            assert after == await sql(protocol_query,protocol_id)
            stale = await client.post('/api/v1/crypto/source-events', json=event(6,[custody]))
            assert stale.status_code == 400
            back = dict(kind='lp_custody',payload={**custody['payload'],'from_custody':'0:'+'b'*64,'to_custody':'main'})
            response = await client.post('/api/v1/crypto/source-events',json=event(6,[back]))
            assert response.status_code == 200, response.text
            assert (await sql(protocol_query,protocol_id))['metadata']['lp_receipt']==receipt
            # A full LP exit may return fewer A and more B. Neither leg loses
            # capital and a composition change is not a free staking reward.
            a2 = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('LPA','LPA','testnet',$1,9) RETURNING id", 'a'+str(uid))
            b2 = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('LPB','LPB','testnet',$1,9) RETURNING id", 'b'+str(uid))
            c2 = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('LPC','LPC','testnet',$1,9) RETURNING id", 'c'+str(uid))
            commands = []
            for token, cost in [(a2,'10'),(b2,'20')]:
                commands += [dict(kind='bank_buy',payload=dict(bank_account_id=bank,crypto_asset_id=token,quantity='10',fiat_currency_code='RUB',fiat_amount=cost)),
                    dict(kind='bank_to_portfolio',payload=dict(bank_account_id=bank,investment_account_id=inv,crypto_asset_id=token,quantity='10'))]
            response = await client.post('/api/v1/crypto/source-events',json=event(7,commands))
            assert response.status_code == 200, response.text
            pa,pb = response.json()['results'][1]['position_id'],response.json()['results'][3]['position_id']
            make_lp = dict(kind='create_protocol',payload=dict(investment_account_id=inv,protocol_name='Two leg LP',position_type='liquidity_pool',asset_symbol='LPA',
                quantity='10',source_position_id=pa,crypto_asset_id=a2,secondary_source_position_id=pb,secondary_quantity='10'))
            response = await client.post('/api/v1/crypto/source-events',json=event(8,[make_lp]))
            assert response.status_code == 200, response.text
            lp = response.json()['results'][0]['id']
            close = dict(kind='close_protocol',payload=dict(position_id=lp,return_quantity='5',secondary_return_quantity='20'))
            for patch in [dict(return_value_in_base='30',secondary_return_value_in_base='20'),dict(return_quantity='0')]:
                bad = await client.post('/api/v1/crypto/source-events',json=event(9,[dict(kind='close_protocol',payload={**close['payload'],**patch})]))
                assert bad.status_code == 400, bad.text
                assert (await sql(protocol_query,lp))['status']=='open'
            response = await client.post('/api/v1/crypto/source-events',json=event(9,[close]))
            assert response.status_code == 200, response.text
            positions = await sql("SELECT jsonb_object_agg(metadata->>'crypto_asset_id',id) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND status='open'",inv)
            pa,pb=positions[str(a2)],positions[str(b2)]
            for position,qty,cost in [(pa,5,10),(pb,20,20)]:
                summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',position)
                assert summary['quantity_now']==qty and summary['remaining_cost_basis']==cost,summary
            assert await sql("SELECT count(*) FROM budgeting.portfolio_events WHERE position_id=ANY($1::bigint[]) AND event_type='income'",[pa,pb])==0
            repeat=await client.post('/api/v1/crypto/source-events',json=event(9,[close]))
            assert repeat.json()==response.json()
            swap=dict(kind='swap',payload=dict(position_id=pa,from_amount='1',to_crypto_asset_id=c2,to_amount='2'))
            response=await client.post('/api/v1/crypto/source-events',json=event(10,[swap]))
            assert response.status_code==200,response.text
            pc=await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2 AND status='open'",inv,str(c2))
            make_unknown=dict(kind='create_protocol',payload={**make_lp['payload'],'source_position_id':pa,'quantity':'2','secondary_source_position_id':pc,'secondary_quantity':'2'})
            response=await client.post('/api/v1/crypto/source-events',json=event(11,[make_unknown]))
            assert response.status_code==200,response.text
            lp=response.json()['results'][0]['id']
            raw=await sql(protocol_query,lp)
            assert raw['cost_basis_in_base'] is None and raw['metadata']['token1_basis_quality']=='unknown'
            close_unknown=dict(kind='close_protocol',payload=dict(position_id=lp,return_quantity='1',secondary_return_quantity='3'))
            bad=await client.post('/api/v1/crypto/source-events',json=event(12,[dict(kind='close_protocol',payload={**close_unknown['payload'],'return_value_in_base':'4','secondary_return_value_in_base':'0'})]))
            assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(12,[close_unknown]))
            assert response.status_code==200,response.text
            pa=await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2 AND status='open'",inv,str(a2))
            pc=await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2 AND status='open'",inv,str(c2))
            sa=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pa)
            sc=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pc)
            assert sa['remaining_cost_basis']==8 and sa['quantity_now']==3,sa
            assert sc['remaining_cost_basis'] is None and sc['basis_quality']=='unknown' and sc['quantity_now']==3,sc
            ton=await sql("SELECT id FROM budgeting.crypto_assets WHERE network_code='ton' AND COALESCE(contract_address,'')='' LIMIT 1")
            st=await sql("SELECT id FROM budgeting.crypto_assets WHERE network_code='ton' AND contract_address='0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892' LIMIT 1")
            if st is None:
                st=await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('stTON','bemo receipt','ton','0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892',9) RETURNING id")
            response=await client.post('/api/v1/crypto/source-events',json=event(13,[
                dict(kind='bank_buy',payload=dict(bank_account_id=bank,crypto_asset_id=ton,quantity='10',fiat_currency_code='RUB',fiat_amount='10')),
                dict(kind='bank_to_portfolio',payload=dict(bank_account_id=bank,investment_account_id=inv,crypto_asset_id=ton,quantity='10'))]))
            assert response.status_code==200,response.text
            pt=response.json()['results'][1]['position_id']
            convert=dict(kind='staking_convert',payload=dict(position_id=pt,from_amount='5',to_crypto_asset_id=st,to_amount='4.8'))
            for patch in [dict(to_crypto_asset_id=c2),dict(value_in_base='999'),dict(from_amount='11')]:
                bad=await client.post('/api/v1/crypto/source-events',json=event(14,[dict(kind='staking_convert',payload={**convert['payload'],**patch})]))
                assert bad.status_code in (400,422),bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(14,[convert]))
            assert response.status_code==200,response.text
            ps=response.json()['results'][0]['position_id']
            assert response.json()['results'][0]['carried_cost_basis']==5
            response=await client.post('/api/v1/crypto/source-events',json=event(15,[dict(kind='staking_convert',payload=dict(position_id=ps,from_amount='4.8',to_crypto_asset_id=ton,to_amount='5.1'))]))
            assert response.status_code==200,response.text
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pt)
            assert summary['remaining_cost_basis']==10 and str(summary['quantity_now'])=='10.1',summary
            unknown=dict(kind='receive_unknown',payload=dict(investment_account_id=inv,crypto_asset_id=ton,quantity='0.0000018',comment='Unclassified incoming quantity, not a zero-cost reward'))
            response=await client.post('/api/v1/crypto/source-events',json=event(16,[unknown]))
            assert response.status_code==200,response.text
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pt)
            assert summary['remaining_cost_basis'] is None and summary['basis_quality']=='unknown',summary
            repeat=await client.post('/api/v1/crypto/source-events',json=event(16,[unknown]))
            assert repeat.json()==response.json()
            response=await client.post('/api/v1/crypto/source-events',json=event(17,[convert]))
            assert response.status_code==200,response.text
            ps=response.json()['results'][0]['position_id']
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',ps)
            assert summary['remaining_cost_basis'] is None and summary['basis_quality']=='unknown',summary
            response=await client.post('/api/v1/crypto/source-events',json=event(18,[dict(kind='fee',payload=dict(source_position_id=pa,quantity='1'))]))
            assert response.status_code==200,response.text
            refund=dict(kind='fee_refund',payload=dict(investment_account_id=inv,crypto_asset_id=a2,quantity='0.5'))
            response=await client.post('/api/v1/crypto/source-events',json=event(19,[refund]))
            assert response.status_code==200,response.text
            assert response.json()['results'][0]['entry_value_in_base']==1.34,response.text
            repeat=await client.post('/api/v1/crypto/source-events',json=event(19,[refund]))
            assert repeat.json()==response.json()
            response=await client.post('/api/v1/crypto/source-events',json=event(20,[refund]))
            assert response.status_code==200,response.text
            assert response.json()['results'][0]['entry_value_in_base']==1.33,response.text
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pa)
            assert summary['remaining_cost_basis']==8 and summary['quantity_now']==3,summary
            bad=await client.post('/api/v1/crypto/source-events',json=event(21,[refund]))
            assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(21,[dict(kind='fee',payload=dict(source_position_id=pt,quantity='1'))]))
            assert response.status_code==200,response.text
            response=await client.post('/api/v1/crypto/source-events',json=event(22,[dict(kind='fee_refund',payload=dict(investment_account_id=inv,crypto_asset_id=ton,quantity='1'))]))
            assert response.status_code==200,response.text
            assert response.json()['results'][0]['entry_value_in_base'] is None,response.text
            response=await client.post('/api/v1/crypto/source-events',json=event(23,[dict(kind='create_protocol',payload={**make_lp['payload'],'source_position_id':pa,'quantity':'1','secondary_source_position_id':pb,'secondary_quantity':'2'})]))
            assert response.status_code==200,response.text
            lp=response.json()['results'][0]['id']
            equal=dict(kind='close_protocol',payload=dict(position_id=lp,return_quantity='1',secondary_return_quantity='2',allocation_policy='equal'))
            bad=await client.post('/api/v1/crypto/source-events',json=event(24,[dict(kind='close_protocol',payload={**equal['payload'],'return_value_in_base':'2.67','secondary_return_value_in_base':'2'})]))
            assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(24,[equal]))
            assert response.status_code==200,response.text
            for position,cost in [(pa,Decimal('7.67')),(pb,Decimal('20.33'))]:
                summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',position)
                assert Decimal(str(summary['remaining_cost_basis']))==cost and summary['basis_quality']=='estimated',summary
            assert (await sql(protocol_query,lp))['metadata']['return_basis_allocation_policy']=='equal'
            repeat=await client.post('/api/v1/crypto/source-events',json=event(24,[equal]))
            assert repeat.json()==response.json()
            response=await client.post('/api/v1/crypto/source-events',json=event(25,[dict(kind='create_protocol',payload={**make_lp['payload'],'source_position_id':pa,'quantity':'1','secondary_source_position_id':pc,'secondary_quantity':'1'})]))
            assert response.status_code==200,response.text
            lp=response.json()['results'][0]['id']
            response=await client.post('/api/v1/crypto/source-events',json=event(26,[dict(kind='close_protocol',payload={**equal['payload'],'position_id':lp,'secondary_return_quantity':'1'})]))
            assert response.status_code==200,response.text
            for position in (pa,pc):
                summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',position)
                assert summary['remaining_cost_basis'] is None and summary['basis_quality']=='unknown',summary
            estimated=dict(kind='swap',payload=dict(position_id=pc,from_amount='1',to_crypto_asset_id=b2,to_amount='1',value_in_base='4',valuation_source='historical reference fixture',valuation_quality='estimated'))
            for patch in [dict(valuation_quality='known'),dict(value_in_base=None),dict(valuation_source='')]:
                bad=await client.post('/api/v1/crypto/source-events',json=event(27,[dict(kind='swap',payload={**estimated['payload'],**patch})]))
                assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(27,[estimated]))
            assert response.status_code==200,response.text
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pb)
            assert summary['basis_quality']=='estimated' and Decimal(str(summary['remaining_cost_basis']))==Decimal('24.33'),summary
            repeat=await client.post('/api/v1/crypto/source-events',json=event(27,[estimated]))
            assert repeat.json()==response.json()
            response=await client.post('/api/v1/crypto/source-events',json=event(28,[dict(kind='create_protocol',payload=dict(investment_account_id=inv,protocol_name='Estimated debt test',position_type='lending',asset_symbol='LPB',quantity='1',source_position_id=pb,crypto_asset_id=b2))]))
            assert response.status_code==200,response.text
            lending=response.json()['results'][0]['id']
            loan=dict(kind='borrow',payload=dict(position_id=lending,debt_qty='2',borrowed_crypto_asset_id=a2,value_in_base='6',valuation_quality='estimated',valuation_source='reference test'))
            bad=await client.post('/api/v1/crypto/source-events',json=event(29,[dict(kind='borrow',payload={**loan['payload'],'valuation_source':''})]))
            assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(29,[loan]))
            assert response.status_code==200,response.text
            assert (await sql(protocol_query,lending))['metadata']['debt_basis_quality']=='estimated'
            response=await client.post('/api/v1/crypto/source-events',json=event(30,[dict(kind='accrue',payload=dict(position_id=lending,collateral_qty='0',interest_qty='0.1',interest_value_in_base='0.3',collateral_before='1',debt_before='2',valuation_quality='estimated',valuation_source='reference test'))]))
            assert response.status_code==200,response.text
            response=await client.post('/api/v1/crypto/source-events',json=event(31,[dict(kind='repay',payload=dict(position_id=lending,source_position_id=pa,repay_qty='0.1',interest_qty='0.1',value_in_base='0.3',valuation_quality='estimated',valuation_source='reference test'))]))
            assert response.status_code==200,response.text
            md=(await sql(protocol_query,lending))['metadata']
            assert md['debt_basis_quality']=='estimated' and Decimal(str(md['debt_cost_basis_in_base']))==6,md
            zero=dict(kind='receive_unknown',payload=dict(investment_account_id=inv,crypto_asset_id=b2,quantity='0.0000018',basis_assumption='owner_zero',comment='Explicit owner convention; origin unknown'))
            response=await client.post('/api/v1/crypto/source-events',json=event(32,[zero]))
            assert response.status_code==200,response.text
            entry=await sql('SELECT to_jsonb(e) FROM budgeting.portfolio_events e WHERE id=$1',response.json()['results'][0]['event_id'])
            assert entry['event_type']=='top_up' and entry['metadata']['entry_value_in_base']==0 and entry['metadata']['basis_quality']=='estimated',entry
            assert entry['metadata']['source_kind']=='unclassified_receipt' and 'income_kind' not in entry['metadata'],entry
            repeat=await client.post('/api/v1/crypto/source-events',json=event(32,[zero]))
            assert repeat.json()==response.json()
            # Carry policy is explicit and preserves both value and uncertainty.
            before=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',pb)
            qty=await sql('SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1',pb)
            carried=dict(kind='swap',payload=dict(position_id=pb,from_amount=str(qty),to_crypto_asset_id=c2,to_amount='7',basis_policy='carry'))
            bad=await client.post('/api/v1/crypto/source-events',json=event(33,[dict(kind='swap',payload={**carried['payload'],'value_in_base':'999'})]))
            assert bad.status_code==400,bad.text
            response=await client.post('/api/v1/crypto/source-events',json=event(33,[carried]))
            assert response.status_code==200,response.text
            result=response.json()['results'][0]
            assert Decimal(str(result['carried_cost_basis']))==Decimal(str(before['remaining_cost_basis'])),result
            assert result['basis_quality']==before['basis_quality'],result
            legs=await sql("SELECT jsonb_agg(metadata) FROM budgeting.portfolio_events WHERE linked_operation_id=$1",result['operation_id'])
            assert all(x['realized_in_base']==0 and 'value_at_swap_in_base' not in x for x in legs),legs
            repeat=await client.post('/api/v1/crypto/source-events',json=event(33,[carried]))
            assert repeat.json()==response.json()
            unknown=dict(kind='swap',payload=dict(position_id=pc,from_amount='1',to_crypto_asset_id=b2,to_amount='1',basis_policy='carry'))
            response=await client.post('/api/v1/crypto/source-events',json=event(34,[unknown]))
            assert response.status_code==200,response.text
            result=response.json()['results'][0]
            assert result['carried_cost_basis'] is None and result['basis_quality']=='unknown',result
            for case,(out_a,out_b,expected_a,expected_b) in enumerate([
                ('1','20','1','19'), ('11','9','11','9'), ('11','11','10','10')
            ]):
                tokens=[]
                for side in ('x','y'):
                    tokens.append(await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('NET','Net test','testnet',$1,18) RETURNING id", f'{uid}-net-{case}-{side}'))
                await sql("SELECT budgeting.put__record_income($1,$2,20,'RUB')",uid,bank)
                commands=[]
                for token in tokens:
                    commands += [dict(kind='bank_buy',payload=dict(bank_account_id=bank,crypto_asset_id=token,quantity='10',fiat_currency_code='RUB',fiat_amount='10')),
                        dict(kind='bank_to_portfolio',payload=dict(bank_account_id=bank,investment_account_id=inv,crypto_asset_id=token,quantity='10'))]
                response=await client.post('/api/v1/crypto/source-events',json=event(35+case*3,commands))
                assert response.status_code==200,response.text
                px,py=response.json()['results'][1]['position_id'],response.json()['results'][3]['position_id']
                response=await client.post('/api/v1/crypto/source-events',json=event(36+case*3,[dict(kind='create_protocol',payload={**make_lp['payload'],'source_position_id':px,'crypto_asset_id':tokens[0],'secondary_source_position_id':py})]))
                assert response.status_code==200,response.text
                lp=response.json()['results'][0]['id']
                close_net=dict(kind='close_protocol',payload=dict(position_id=lp,return_quantity=out_a,secondary_return_quantity=out_b,allocation_policy='net_composition'))
                for patch in [dict(return_quantity='1',secondary_return_quantity='1'),dict(return_value_in_base='10',secondary_return_value_in_base='10')]:
                    bad=await client.post('/api/v1/crypto/source-events',json=event(37+case*3,[dict(kind='close_protocol',payload={**close_net['payload'],**patch})]))
                    assert bad.status_code==400,bad.text
                    assert (await sql(protocol_query,lp))['status']=='open'
                response=await client.post('/api/v1/crypto/source-events',json=event(37+case*3,[close_net]))
                assert response.status_code==200,response.text
                for token,cost in zip(tokens,(expected_a,expected_b), strict=True):
                    position=await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND status='open' AND (metadata->>'crypto_asset_id')::bigint=$2",inv,token)
                    summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',position)
                    assert Decimal(str(summary['remaining_cost_basis']))==Decimal(cost),summary
                repeat=await client.post('/api/v1/crypto/source-events',json=event(37+case*3,[close_net]))
                assert repeat.json()==response.json()
            correction=dict(kind='quantity_correction',payload=dict(investment_account_id=inv,crypto_asset_id=tokens[0],quantity='0.02',comment='Rounded source discrepancy'))
            before=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',position)
            body=event(44,[correction])
            bad=await client.post('/api/v1/crypto/source-events',json=body)
            assert bad.status_code==400,bad.text
            body['evidence']={'quantity_correction':{'source':'test source','shortfall':'0.02'}}
            response=await client.post('/api/v1/crypto/source-events',json=body)
            assert response.status_code==200,response.text
            result=response.json()['results'][0]
            e=await sql('SELECT to_jsonb(e) FROM budgeting.portfolio_events e WHERE id=$1',result['event_id'])
            assert e['event_type']=='top_up' and e['metadata']['entry_value_in_base']==0 and 'income_kind' not in e['metadata'],e
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',result['position_id'])
            assert Decimal(str(summary['remaining_cost_basis']))==10 and Decimal(str(summary['quantity_now']))==Decimal('11.02'),summary
            repeat=await client.post('/api/v1/crypto/source-events',json=body)
            assert repeat.json()==response.json()
            debt_asset=await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('DEBT','Debt test','testnet',$1,18) RETURNING id",str(uid)+'debt')
            output_asset=await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('FUNDED','Funded test','testnet',$1,18) RETURNING id",str(uid)+'funded')
            collateral=result['position_id']
            response=await client.post('/api/v1/crypto/source-events',json=event(45,[dict(kind='create_protocol',payload=dict(investment_account_id=inv,protocol_name='Component loan',position_type='lending',asset_symbol='NET',quantity='1',source_position_id=collateral,crypto_asset_id=tokens[0]))]))
            assert response.status_code==200,response.text
            loan_id=response.json()['results'][0]['id']
            borrow=dict(kind='borrow',payload=dict(position_id=loan_id,debt_qty='40',borrowed_crypto_asset_id=debt_asset,funding_policy='components'))
            response=await client.post('/api/v1/crypto/source-events',json=event(46,[borrow]))
            assert response.status_code==200,response.text
            debt_position=response.json()['results'][0]['metadata']['borrowed_position_id']
            response=await client.post('/api/v1/crypto/source-events',json=event(47,[dict(kind='swap',payload=dict(position_id=debt_position,from_amount='20',to_crypto_asset_id=output_asset,to_amount='250',basis_policy='carry')),dict(kind='expense',payload=dict(source_position_id=debt_position,quantity='20'))]))
            assert response.status_code==200,response.text
            funded_position=response.json()['results'][0]['position_id']
            await sql("SELECT budgeting.put__record_income($1,$2,3000,'RUB')",uid,bank)
            response=await client.post('/api/v1/crypto/source-events',json=event(48,[dict(kind='bank_buy',payload=dict(bank_account_id=bank,crypto_asset_id=debt_asset,quantity='10',fiat_currency_code='RUB',fiat_amount='3000')),dict(kind='bank_to_portfolio',payload=dict(bank_account_id=bank,investment_account_id=inv,crypto_asset_id=debt_asset,quantity='10'))]))
            assert response.status_code==200,response.text
            debt_position=response.json()['results'][1]['position_id']
            repayment=dict(kind='repay',payload=dict(position_id=loan_id,source_position_id=debt_position,repay_qty='10'))
            response=await client.post('/api/v1/crypto/source-events',json=event(49,[repayment]))
            assert response.status_code==200,response.text
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',funded_position)
            assert summary['remaining_cost_basis']==1500 and Decimal(str(summary['funding_units'][str(loan_id)]))==15,summary
            assert not summary['basis_final'],summary
            allocated=await sql("SELECT sum((metadata->>'funding_confirmed_cost')::numeric) FROM budgeting.portfolio_events WHERE created_by_user_id=$1",uid)
            assert allocated==1500,allocated
            repeat=await client.post('/api/v1/crypto/source-events',json=event(49,[repayment]))
            assert repeat.json()==response.json()
            # New borrowing must not dilute already confirmed costs; unused return cancels itself.
            response=await client.post('/api/v1/crypto/source-events',json=event(50,[dict(kind='borrow',payload={**borrow['payload'],'debt_qty':'10'})]))
            assert response.status_code==200,response.text
            debt_position=response.json()['results'][0]['metadata']['borrowed_position_id']
            response=await client.post('/api/v1/crypto/source-events',json=event(51,[dict(kind='repay',payload={**repayment['payload'],'source_position_id':debt_position})]))
            assert response.status_code==200,response.text
            after=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',funded_position)
            assert after==summary,(after,summary)
            response=await client.get(f'/api/v1/crypto/accounts/{inv}/assets/{output_asset}')
            assert response.status_code==200,response.text
            detail=response.json()
            assert detail['basis_final'] is False and detail['funding_units'][str(loan_id)]==15,detail
            assert detail['funding_components'][0]['symbol']=='DEBT',detail
            try:
                await sql('SELECT budgeting.get__crypto_position_movable_entry_summary($1)',funded_position)
            except asyncpg.RaiseError:
                pass
            else:
                raise AssertionError('Direct mutation of funded position must require the journal')
            # A zero-value chain message is auditable but must not fabricate a ledger entry.
            observation = event(52,[dict(kind='observation',payload=dict(comment='Zero movement message'))])
            count_before = await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1',uid)
            bad = await client.post('/api/v1/crypto/source-events',json=observation)
            assert bad.status_code==400,bad.text
            observation['evidence']={'zero_movement':True}
            response=await client.post('/api/v1/crypto/source-events',json=observation)
            assert response.status_code==200,response.text
            assert response.json()['links']==[]
            assert await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1',uid)==count_before
            assert (await client.post('/api/v1/crypto/source-events',json=observation)).json()==response.json()
            await sql("SELECT budgeting.put__record_income($1,$2,100,'RUB')",uid,bank)
            buy_estimate=event(53,[dict(kind='bank_buy',payload=dict(bank_account_id=bank,crypto_asset_id=debt_asset,quantity='1',fiat_currency_code='RUB',fiat_amount='100')),dict(kind='bank_to_portfolio',payload=dict(bank_account_id=bank,investment_account_id=inv,crypto_asset_id=debt_asset,quantity='1',purchase_quality='estimated'))])
            bad=await client.post('/api/v1/crypto/source-events',json=buy_estimate)
            assert bad.status_code==400,bad.text
            buy_estimate['commands'][1]['payload']['purchase_source']='Owner accepted historical estimate'
            response=await client.post('/api/v1/crypto/source-events',json=buy_estimate)
            assert response.status_code==200,response.text
            estimate_position=response.json()['results'][1]['position_id']
            summary=await sql('SELECT budgeting.get__crypto_position_entry_summary($1)',estimate_position)
            assert summary['basis_quality']=='estimated' and summary['remaining_cost_basis']==100,summary
            assert (await client.post('/api/v1/crypto/source-events',json=buy_estimate)).json()==response.json()
        print('observation: evidence guard, no ledger change, repeat; estimated bank funding: source guard, rollback, quality and repeat passed')
        print('funding: partial repayment to asset/expense, actual costs, new borrowing and self-return, repeat passed')
        print('quantity correction: evidence required, no new cost or income, exact quantity and repeat passed')
        print('net LP composition: both directions, both-growing, loss/override rejection and repeat passed')
        print('carry swaps: preserved full value/quality, unknown propagation, valuation conflict and repeat passed')
        print('estimated loan/interest/repayment and explicit zero-cost receipt convention passed')
        print('reference swap valuation: explicit quality, missing-value/source guards, unknown source cost and repeat passed')
        print('equal LP allocation: odd-cent conservation, conflicting values rejected, idempotence and unknown total propagation passed')
        print('fee refunds: historical cost, cent remainder, repeat, pool exhaustion and unknown-cost propagation passed')
        print('staking conversion: round-trip basis, source/target guards, unknown propagation; unclassified receipt not a free reward passed')
        print('lp_full_exit: shrunk/grown legs preserve cost, identity survives reopening, unknown stays unknown, false allocation rejected, repeat passed')
        print('lp_custody: cost preservation, whole receipt guards, rollback, retry, stale source and return passed')
        print('bank_journal_api: bank-only exchange, exact 18 decimals, cost-preserving transfer, atomic rollback, 7 invalid cases and idempotent batch passed')
    finally:
        await pool.close()


asyncio.run(main())
