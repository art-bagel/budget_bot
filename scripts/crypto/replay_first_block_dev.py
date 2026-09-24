"""Persistent, resumable chronological replay on the disposable local dev DB only.

No token quantities or basis are seeded. RUB funding matches each documented
purchase and is explicitly a portfolio funding boundary, not reconstructed income.
"""
import argparse
import asyncio
from datetime import date
from decimal import Decimal
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

from compile_main_commands import bind_commands

parser = argparse.ArgumentParser()
parser.add_argument('--socket', type=Path, required=True)
parser.add_argument('--port', type=int, default=55441)
parser.add_argument('--database', default='boundary_usd_clean')
parser.add_argument('--plan', type=Path, required=True)
parser.add_argument('--state', type=Path, required=True)
parser.add_argument('--allow-isolated-funding-fixture', action='store_true', help='Test funding only, never use for production import')
args = parser.parse_args()
if not str(args.socket.resolve()).startswith('/private/tmp/crypto-portfolio-audit.') or not args.database.startswith('boundary_'):
    raise ValueError('Only disposable local boundary dev cluster is supported')
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(args.socket), DB_PORT=str(args.port),
    DB_DATABASE=args.database, DB_SCHEMA='budgeting', POSTGRES_USER='audit', POSTGRES_PASSWORD='', TELEGRAM_BOT_TOKEN='')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto, portfolio  # noqa: E402


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(state):
    temp = args.state.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2, default=str) + '\n')
    temp.replace(args.state)


async def main():
    plan = json.loads(args.plan.read_text())
    pool = await crypto.ledger._get_pool()

    async def sql(q, *values):
        async with pool.acquire() as db:
            return await db.fetchval(q, *values)

    try:
        if args.state.exists():
            state = json.loads(args.state.read_text())
            if state['database'] != args.database or state['socket'] != str(args.socket):
                raise ValueError('State belongs to another database')
            uid, accounts, assets = state['user_id'], state['accounts'], state['assets']
            if (state.get('funding_mode') == 'isolated_fixture') != args.allow_isolated_funding_fixture:
                raise ValueError('Cannot change funding mode of an existing replay')
            assert await sql("SELECT count(*)=1 FROM budgeting.bank_accounts WHERE id=$1 AND owner_user_id=$2 AND account_kind='investment' AND investment_asset_type='crypto'", accounts['main'], uid)
            for row in plan['rows']:
                old = state['posted'].get(row['source_id'])
                if old and old['input_hash'] != digest(row):
                    raise ValueError('Posted history changed: rebuild on a fresh isolated owner')
            assert set(state['posted']) <= {r['source_id'] for r in plan['rows']}, 'Cannot remove posted history'
        else:
            async with pool.acquire() as db, db.transaction():
                await db.execute('SELECT pg_advisory_xact_lock(942301006)')
                uid = await db.fetchval("INSERT INTO budgeting.users(id,base_currency_code) SELECT COALESCE(max(id),1000000)+1,'RUB' FROM budgeting.users WHERE id BETWEEN 1000000 AND 2000000 RETURNING id")
                await db.execute("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system'),('user',$1,'FX Result','system')", uid)
                accounts = {}
                for wallet, name in [('main', 'История main — первая сотня'), ('telegram', 'Telegram — источники main'), ('primary_cash', 'Документированные вложения RUB')]:
                    accounts[wallet] = await db.fetchval("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,$2,$3,$4) RETURNING id", uid, name, 'cash' if wallet == 'primary_cash' else 'investment', None if wallet == 'primary_cash' else 'crypto')
                assets = {}
                for master in ('native TON', '0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc'):
                    asset = plan['assets'][master]
                    address = '' if master == 'native TON' else master
                    asset_id = await db.fetchval("SELECT id FROM budgeting.crypto_assets WHERE network_code='ton' AND contract_address IS NOT DISTINCT FROM $1 AND symbol=$2 LIMIT 1", address, asset['symbol'])
                    if asset_id is None:
                        asset_id = await db.fetchval("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ($1,$1,'ton',$2,$3) RETURNING id", asset['symbol'], address, asset['decimals'])
                    assets[master] = asset_id
            state = dict(funding_mode='isolated_fixture' if args.allow_isolated_funding_fixture else 'existing_cash_only', user_id=uid, accounts=accounts, assets=assets, database=args.database, socket=str(args.socket), posted={}, verified_through=0,
                         limitations=['Historical RUB funding boundary, not a bank income reconstruction', 'Unknown-time purchases use explicitly labelled ordering placeholders', 'Pre-main 4.947 TON outflow has unknown destination', '0.05 TON withdrawal difference treated as separate fee under current policy', 'LP receipt quantity kept in protocol evidence, not duplicated as free token capital', 'Not the full first hundred; no full app UI verification yet'])
            save(state)
        def references(value):
            if isinstance(value, dict):
                if 'resource_ref' in value:
                    yield value['resource_ref']
                for item in value.values():
                    yield from references(item)
            elif isinstance(value, list):
                for item in value:
                    yield from references(item)
        refs=set(references(plan['rows']))
        wallets={r.split(':')[1] for r in refs if r.startswith(('account:','position:'))}
        for wallet in sorted(wallets-accounts.keys()):
            async with pool.acquire() as db:
                name={'exchange_source':'Технический источник покупок (dev)', 'battery':'Батарейка — возврат', 'intermediate':'Промежуточный кошелёк', 'second':'Второй кошелёк', 'fourth':'Четвёртый кошелёк', 'telegram_yield':'Размещения Telegram', 'external_evaa':'Стороннее погашение EVAA — технический счёт'}.get(wallet,wallet)
                existing = await db.fetchval("SELECT id FROM budgeting.bank_accounts WHERE owner_user_id=$1 AND name=$2 AND account_kind='investment' AND investment_asset_type='crypto'", uid, name)
                accounts[wallet] = existing or await db.fetchval("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type,provider_name) VALUES ('user',$1,$2,'investment','crypto',$3) RETURNING id",uid,name,'reconstruction_internal' if wallet in plan.get('internal_accounts',[]) else None)
                state['accounts']=accounts
                save(state)
        state['accounts']=accounts
        # Extend the asset dictionary on resume, never create token balances.
        needed = {c['payload'][key]['resource_ref'].split('asset:ton:', 1)[1]
                  for row in plan['rows'] for c in row['commands']
                  for key in ('crypto_asset_id', 'to_crypto_asset_id')
                  if isinstance(c['payload'].get(key), dict) and 'resource_ref' in c['payload'][key]}
        for master in sorted(needed - assets.keys()):
            asset = plan['assets'][master]
            async with pool.acquire() as db:
                asset_id = await db.fetchval("SELECT id FROM budgeting.crypto_assets WHERE network_code=$1 AND contract_address=$2 LIMIT 1", asset.get('network_code','ton'), master)
                if asset_id is None:
                    asset_id = await db.fetchval("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ($1,$1,$2,$3,$4) RETURNING id", asset['symbol'], asset.get('network_code','ton'), master, asset['decimals'])
            assets[master] = asset_id
        save(state)
        app = FastAPI()
        app.include_router(crypto.router)
        app.include_router(portfolio.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({'detail': str(exc)}, status_code=400)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for row in plan['rows']:
                # Cash funding and its marker are transactional and resumable even
                # if the subsequent API request fails. Exact documented payment only.
                if row.get('funding_RUB') and args.allow_isolated_funding_fixture:
                    marker = 'DEV ONLY — тестовое финансирование покупки: ' + row['source_id']
                    async with pool.acquire() as db, db.transaction():
                        await db.execute('SELECT pg_advisory_xact_lock($1)', uid)
                        exists = await db.fetchval('SELECT id FROM budgeting.operations WHERE owner_user_id=$1 AND comment=$2', uid, marker)
                        if exists is None:
                            await db.fetchval("SELECT budgeting.put__record_income($1,$2,$3,'RUB',NULL,NULL,$4,$5::date)", uid, accounts['primary_cash'], Decimal(row['funding_RUB']), marker, date.fromisoformat(row['accounting_date']))
                old = state['posted'].get(row['source_id'])
                if not old:
                    stored = await sql("SELECT to_jsonb(s) FROM budgeting.crypto_source_events s WHERE anchor_account_id=$1 AND source_namespace='first-hundred-dev-v1' AND source_id=$2", accounts['main'], row['source_id'])
                    if stored:
                        if stored['evidence'].get('input_hash') != digest(row):
                            raise ValueError('Persisted source differs from plan; rebuild required')
                        old = dict(input_hash=digest(row), response=stored['result'], request={
                            k: stored[k] for k in ('anchor_account_id','source_namespace','source_id','occurred_at','accounting_date','order_in_timestamp','commands','evidence')})
                if old:
                    body = old['request']
                else:
                    bindings = {'account:' + k: v for k, v in accounts.items()}
                    bindings.update({'asset:ton:' + k: v for k, v in assets.items()})
                    wallets_by_id = {value:key for key,value in accounts.items()}
                    masters_by_id = {str(value):key for key,value in assets.items()}
                    async with pool.acquire() as db:
                        positions = await db.fetch("SELECT id,investment_account_id,metadata->>'crypto_asset_id' asset_id FROM budgeting.portfolio_positions WHERE investment_account_id=ANY($1::bigint[]) AND status='open'", list(accounts.values()))
                    for pos in positions:
                        if pos['asset_id'] in masters_by_id:
                            wallet = wallets_by_id[pos['investment_account_id']]
                            master = masters_by_id[pos['asset_id']]
                            bindings[f'position:{wallet}:ton:{master}'] = pos['id']
                    async with pool.acquire() as db:
                        for protocol in await db.fetch("SELECT id,COALESCE(metadata->'lp_receipt'->>'event_id',metadata->>'source_event_id') AS source_id FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND (metadata ? 'lp_receipt' OR metadata ? 'source_event_id')", uid):
                            bindings['protocol:' + protocol['source_id']] = protocol['id']
                    body = dict(anchor_account_id=accounts['main'], source_namespace='first-hundred-dev-v1', source_id=row['source_id'],
                        occurred_at=row['occurred_at'], accounting_date=row['accounting_date'], order_in_timestamp=row['order_in_timestamp'],
                        commands=bind_commands(row['commands'], bindings), evidence={**row['evidence'], 'input_hash': digest(row), 'inputs': plan['inputs']})
                before = await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1', uid)
                response = await client.post('/api/v1/crypto/source-events', json=body)
                if response.status_code != 200:
                    raise RuntimeError(row['source_id'] + ': ' + response.text)
                result = response.json()
                if old:
                    assert result == old['response'], 'Replay result changed'
                    assert await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1', uid) == before
                elif 'event_no' in row:
                    for master, quantity in row['expected_main'].items():
                        if master in plan.get('excluded_assets', {}):
                            continue
                        if master in assets:
                            actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", accounts['main'], str(assets[master]))
                        else:
                            actual = await sql("SELECT COALESCE(sum((metadata->'lp_receipt'->>'quantity')::numeric),0) FROM budgeting.crypto_protocol_positions WHERE investment_account_id=$1 AND status='open' AND metadata->'lp_receipt'->>'master'=$2 AND metadata->'lp_receipt'->>'custody'='main'", accounts['main'], master)
                        assert actual == Decimal(quantity), (row['event_no'], master, actual, quantity)
                    state['verified_through'] = row['event_no']
                state['posted'][row['source_id']] = dict(input_hash=digest(row), request=body, response=result)
                if not old:
                    save(state)
            # Final-state checks also execute on a repeated run.
            last = next(r for r in reversed(plan['rows']) if 'event_no' in r)
            for master, quantity in last['expected_main'].items():
                if master in plan.get('excluded_assets', {}):
                    continue
                if master in assets:
                    actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", accounts['main'], str(assets[master]))
                else:
                    actual = await sql("SELECT COALESCE(sum((metadata->'lp_receipt'->>'quantity')::numeric),0) FROM budgeting.crypto_protocol_positions WHERE investment_account_id=$1 AND status='open' AND metadata->'lp_receipt'->>'master'=$2 AND metadata->'lp_receipt'->>'custody'='main'", accounts['main'], master)
                assert actual == Decimal(quantity), (master, actual, quantity)
            if last.get('lp_receipt'):
                receipt = last['lp_receipt']
                assert await sql("SELECT metadata->'lp_receipt' FROM budgeting.crypto_protocol_positions WHERE investment_account_id=$1 AND metadata->'lp_receipt'->>'master'=$2", accounts['main'], receipt['master']) == receipt
            assert await sql("SELECT COALESCE((SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'),0)", accounts['primary_cash']) == Decimal(plan.get('expected_bank_RUB','0'))
            summaries = []
            async with pool.acquire() as db:
                for r in await db.fetch('SELECT id,investment_account_id,title FROM budgeting.portfolio_positions WHERE owner_user_id=$1 ORDER BY id', uid):
                    summaries.append({**dict(r), 'summary': await db.fetchval('SELECT budgeting.get__crypto_position_entry_summary($1)', r['id'])})
            response = await client.get('/api/v1/crypto/protocol-positions')
            assert response.status_code == 200, response.text
            state.update(position_summaries=summaries, protocol_positions=response.json(), first_unimplemented_event=plan['summary']['first_unimplemented_event'], block_closed=False,
                         documented_funding_RUB=str(sum(Decimal(r.get('funding_RUB', '0')) for r in plan['rows'])))
            funding = Decimal(state['documented_funding_RUB'])
            unknown_positions = [p for p in summaries if p['summary']['remaining_cost_basis'] is None and Decimal(str(p['summary']['quantity_now']))>0]
            opened_protocols=[p for p in state['protocol_positions'] if p['status']=='open']
            unknown_protocols=[p for p in opened_protocols if p['cost_basis_in_base'] is None]
            held = sum(Decimal(str(p['summary']['remaining_cost_basis'])) for p in summaries if p['summary']['remaining_cost_basis'] is not None)
            protocol_basis = sum(Decimal(str(p['cost_basis_in_base'])) for p in opened_protocols if p['cost_basis_in_base'] is not None)
            disposed = await sql("SELECT COALESCE(sum((metadata->>'consumed_cost_basis')::numeric),0) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND (event_type='fee' OR metadata->>'target_kind'='expense')", uid)
            swaps = await sql("SELECT COALESCE(sum((metadata->>'consumed_cost_basis')::numeric - COALESCE((metadata->>'value_in_base')::numeric,0)),0) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND event_type='swap_out'", uid)
            unknown_swaps = await sql("SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND event_type='swap_out' AND metadata->>'value_in_base' IS NULL AND metadata->>'economic_kind' IS DISTINCT FROM 'staking_conversion'", uid)
            if last['event_no']<=11:
                for p in unknown_positions:
                    assert p['investment_account_id']==accounts['telegram'] and p['title']=='NOT'
                    assert await sql("SELECT COALESCE(sum((metadata->>'entry_value_in_base')::numeric),0) FROM budgeting.portfolio_events WHERE position_id=$1",p['id'])==0
                assert held+protocol_basis+disposed+swaps==funding
            state['cost_reconciliation']=dict(funding=str(funding),known_position_subtotal=str(held),known_protocol_subtotal=str(protocol_basis),
                unknown_positions=[p['id'] for p in unknown_positions],unknown_protocols=[p['id'] for p in unknown_protocols],unknown_swap_valuations=unknown_swaps,
                status='known_components_checked' if last['event_no']<=11 else 'historical_quantities_checked_full_cost_unresolved',
                total_portfolio_basis=None if unknown_positions or unknown_protocols else str(held+protocol_basis),
                limitation='Unknown values are not zero; known subtotals are not total historical capital')
            if last['event_no']==100 and not unknown_positions and not unknown_protocols and unknown_swaps==0 and not plan.get('funding_components'):
                totals=await sql("""SELECT jsonb_build_object(
                    'fees',COALESCE(sum((metadata->>'consumed_cost_basis')::numeric) FILTER(WHERE event_type='fee'),0),
                    'expenses',COALESCE(sum((metadata->>'consumed_cost_basis')::numeric) FILTER(WHERE metadata->>'target_kind'='expense'),0),
                    'fee_refunds',COALESCE(sum((metadata->>'entry_value_in_base')::numeric) FILTER(WHERE metadata->>'source_kind'='fee_refund'),0),
                    'swap_result',COALESCE(sum((metadata->>'realized_in_base')::numeric) FILTER(WHERE event_type='swap_out'),0),
                    'repay_result',COALESCE(sum((metadata->>'realized_in_base')::numeric) FILTER(WHERE metadata->>'target_kind'='lending_repay'),0),
                    'unknown_disposals',count(*) FILTER(WHERE (event_type='fee' OR metadata->>'target_kind'='expense') AND metadata->>'consumed_cost_basis' IS NULL),
                    'unknown_results',count(*) FILTER(WHERE (event_type='swap_out' OR metadata->>'target_kind'='lending_repay') AND metadata->>'realized_in_base' IS NULL)
                    ) FROM budgeting.portfolio_events WHERE created_by_user_id=$1""",uid)
                assert totals['unknown_disposals']==0 and totals['unknown_results']==0, totals
                interest=await sql("SELECT COALESCE(sum(debt_basis_change_in_base),0) FROM budgeting.crypto_liability_events WHERE created_by_user_id=$1 AND event_kind='interest_accrual'",uid)
                debt=sum(Decimal(str(p['metadata'].get('debt_cost_basis_in_base',0))) for p in opened_protocols)
                expected=funding+Decimal(str(totals['swap_result']))+Decimal(str(totals['repay_result']))-Decimal(str(totals['fees']))-Decimal(str(totals['expenses']))+Decimal(str(totals['fee_refunds']))-interest
                assert held+protocol_basis-debt==expected, (held,protocol_basis,debt,expected,totals)
                state['capital_reconciliation']=dict(**totals,interest_cost=str(interest),debt_basis=str(debt),asset_basis=str(held+protocol_basis),net_basis=str(expected),difference='0.00',quality='estimated_with_documented_conventions')
                state['cost_reconciliation']['status']='reference_estimates_reconciled'
                state['cost_reconciliation']['limitation']='Reference valuations, Telegram rounding and explicitly accepted zero-cost receipt; not exact market or tax accounting'
                state['accounting_closed_with_limitations']=True
            if plan.get('funding_components'):
                assert not unknown_positions and not unknown_protocols and unknown_swaps==0
                totals=await sql("""SELECT jsonb_build_object(
                    'fees',COALESCE(sum((metadata->>'consumed_cost_basis')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER(WHERE event_type='fee'),0)::text,
                    'expenses',COALESCE(sum((metadata->>'consumed_cost_basis')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER(WHERE metadata->>'target_kind'='expense'),0)::text,
                    'refunds',COALESCE(sum((metadata->>'entry_value_in_base')::numeric) FILTER(WHERE metadata->>'source_kind'='fee_refund'),0)::text,
                    'interest',COALESCE(sum((metadata->>'funding_interest_cost')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER(WHERE metadata->>'funding_policy'='components'),0)::text,
                    'bank_withdrawals',COALESCE(sum((metadata->>'consumed_cost_basis')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FILTER(WHERE metadata->>'target_kind'='bank' OR metadata->>'action'='fiat_sell'),0)::text,
                    'swap_result',COALESCE(sum((metadata->>'realized_in_base')::numeric) FILTER(WHERE event_type='swap_out'),0)::text
                    ) FROM budgeting.portfolio_events WHERE created_by_user_id=$1""",uid)
                expected=funding-Decimal(totals['fees'])-Decimal(totals['expenses'])-Decimal(totals['interest'])-Decimal(totals['bank_withdrawals'])+Decimal(totals['refunds'])
                assert held+protocol_basis==expected,(held,protocol_basis,expected,totals)
                assert Decimal(totals['swap_result'])==0
                unit_checks=await sql("""WITH holders AS (
                    SELECT metadata->'funding_units' units FROM budgeting.portfolio_positions WHERE owner_user_id=$1
                    UNION ALL SELECT metadata->'funding_units0' FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1
                    UNION ALL SELECT metadata->'funding_units1' FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1
                    UNION ALL SELECT e.metadata->'funding_units' FROM budgeting.portfolio_events e JOIN budgeting.portfolio_positions p ON p.id=e.position_id WHERE p.owner_user_id=$1
                ), amounts AS (SELECT key,sum(value::numeric) amount FROM holders CROSS JOIN LATERAL jsonb_each_text(COALESCE(units,'{}')) GROUP BY key)
                SELECT COALESCE(jsonb_agg(jsonb_build_object('loan_id',p.id,'units',COALESCE(a.amount,0)::text,
                    'principal',(COALESCE((p.metadata->>'borrowed_quantity')::numeric,0)-COALESCE((p.metadata->>'debt_interest_quantity')::numeric,0))::text)), '[]')
                FROM budgeting.crypto_protocol_positions p LEFT JOIN amounts a ON a.key=p.id::text
                WHERE p.owner_user_id=$1 AND p.metadata->>'funding_policy'='components'""",uid)
                for check in unit_checks:
                    assert Decimal(check['units'])==Decimal(check['principal']),check
                if plan.get('expected_telegram_usdt'):
                    actual=await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2",accounts['telegram'],str(assets['0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe']))
                    assert actual==Decimal(plan['expected_telegram_usdt'])
                state['capital_reconciliation']=dict(**totals,confirmed_asset_cost=str(expected),difference='0.00',funding_units=unit_checks)
                state['cost_reconciliation']['status']='carried_cost_and_components_reconciled'
                state['cost_reconciliation']['limitation']='Historical cash costs including explicitly accepted estimates, plus open financing units; net LP convention and documented micro-rounding'
                state['accounting_closed_with_limitations']=True
            for wallet, expected_assets in plan.get('expected_accounts', {}).items():
                for master, quantity in expected_assets.items():
                    actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", accounts[wallet], str(assets[master]))
                    assert actual == Decimal(quantity), (wallet, master, actual, quantity)
            if 'accepted_custody' in plan or plan.get('accepted_custody_after_200'):
                actual_custody = await sql("""SELECT COALESCE(jsonb_object_agg(master,quantity),'{}') FROM (
                    SELECT metadata->'lp_receipt'->>'master' master, sum((metadata->'lp_receipt'->>'quantity')::numeric)::text quantity
                    FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND status='open'
                    AND metadata ? 'lp_receipt' AND metadata->'lp_receipt'->>'custody'<>'main'
                    GROUP BY 1) t""",uid)
                expected_custody = {}
                for receipt in plan.get('accepted_custody', plan.get('accepted_custody_after_200', [])):
                    expected_custody[receipt['master']] = expected_custody.get(receipt['master'], Decimal(0)) + Decimal(receipt['quantity'])
                assert {k:Decimal(v) for k,v in actual_custody.items()} == expected_custody
                state['custody_verified'] = actual_custody
            for event_no, expected in plan.get('expected_evaa', {}).items():
                source = next(row for row in plan['rows'] if row.get('event_no') == int(event_no))['source_id'].removeprefix('main:')
                actual = await sql("SELECT jsonb_build_object('coll',current_quantity::text,'debt',metadata->>'borrowed_quantity','body',((metadata->>'borrowed_quantity')::numeric-COALESCE((metadata->>'debt_interest_quantity')::numeric,0))::text) FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND metadata->>'source_event_id'=$2", uid, source)
                assert actual and all(Decimal(actual[key]) == Decimal(value) for key, value in expected.items()), (event_no, expected, actual)
            if 'expected_arbitrum' in plan:
                expected = plan['expected_arbitrum']
                actual = await sql("SELECT jsonb_build_object('coll',current_quantity::text,'debt',metadata->>'borrowed_quantity','body',((metadata->>'borrowed_quantity')::numeric-COALESCE((metadata->>'debt_interest_quantity')::numeric,0))::text) FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND metadata->>'source_event_id'='arbitrum:aave'", uid)
                assert actual and all(Decimal(actual[k]) == Decimal(expected[k]) for k in ('coll','debt','body')), (expected, actual)
                assert await sql("SELECT count(*) FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND protocol_name LIKE 'Uniswap%' AND status='open'", uid) == 0
                state['arbitrum_verified'] = dict(**actual, future_rows=len(plan.get('arbitrum_future_rows', [])), diagnostic_only=bool(plan.get('diagnostic_only')))
            if 'expected_bank_USD' in plan:
                assert await sql("SELECT COALESCE(sum(amount),0) FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='USD'", accounts['primary_cash']) == Decimal(plan['expected_bank_USD'])
            state['limitations'] = plan.get('limitations',state['limitations'])
            state['purchase_funding_quality'] = {
                'actual_RUB': str(sum(Decimal(r.get('funding_RUB','0')) for r in plan['rows'] if r.get('funding_quality')!='estimated')),
                'estimated_RUB': str(sum(Decimal(r.get('funding_RUB','0')) for r in plan['rows'] if r.get('funding_quality')=='estimated'))}
            if plan.get('main_account_name'):
                async with pool.acquire() as db:
                    await db.execute('UPDATE budgeting.bank_accounts SET name=$1 WHERE id=$2 AND owner_user_id=$3',plan['main_account_name'],accounts['main'],uid)
            for wallet, name in plan.get('account_display_names', {}).items():
                async with pool.acquire() as db:
                    await db.execute('UPDATE budgeting.bank_accounts SET name=$1 WHERE id=$2 AND owner_user_id=$3', name, accounts[wallet], uid)
            state['verified_through'] = last['event_no']
            state['diagnostic_only'] = bool(plan.get('diagnostic_only', False))
            if state['diagnostic_only']:
                state['accounting_closed_with_limitations'] = False
                state['cost_reconciliation']['status'] = 'diagnostic_only_not_final_policy'
                state['cost_reconciliation']['limitation'] = plan.get('diagnostic_reason', 'Incomplete policy implementation')
            state['block_closed'] = bool(plan.get('close_block')) and not state['diagnostic_only']
            save(state)
            print(json.dumps({k: state[k] for k in ('user_id','verified_through','documented_funding_RUB','first_unimplemented_event','block_closed')}, ensure_ascii=False))
    finally:
        await pool.close()


args.state.parent.mkdir(parents=True, exist_ok=True)
with args.state.with_suffix('.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    asyncio.run(main())
