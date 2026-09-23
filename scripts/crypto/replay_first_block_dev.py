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
            assert await sql("SELECT count(*)=1 FROM budgeting.bank_accounts WHERE id=$1 AND owner_user_id=$2 AND name='История main — первая сотня'", accounts['main'], uid)
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
                    for wallet, account in accounts.items():
                        for master, asset_id in assets.items():
                            pos = await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2 AND status='open'", account, str(asset_id))
                            if pos:
                                bindings[f'position:{wallet}:ton:{master}'] = pos
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
                        if master in assets:
                            actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", accounts['main'], str(assets[master]))
                        else:
                            actual = await sql("SELECT sum((metadata->'lp_receipt'->>'quantity')::numeric) FROM budgeting.crypto_protocol_positions WHERE investment_account_id=$1 AND metadata->'lp_receipt'->>'master'=$2", accounts['main'], master)
                        assert actual == Decimal(quantity), (row['event_no'], master, actual, quantity)
                    state['verified_through'] = row['event_no']
                state['posted'][row['source_id']] = dict(input_hash=digest(row), request=body, response=result)
                save(state)
            # Final-state checks also execute on a repeated run.
            last = next(r for r in reversed(plan['rows']) if 'event_no' in r)
            for master, quantity in last['expected_main'].items():
                if master in assets:
                    actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", accounts['main'], str(assets[master]))
                    assert actual == Decimal(quantity)
            assert await sql("SELECT COALESCE((SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'),0)", accounts['primary_cash']) == 0
            summaries = []
            async with pool.acquire() as db:
                for r in await db.fetch('SELECT id,investment_account_id,title FROM budgeting.portfolio_positions WHERE owner_user_id=$1 ORDER BY id', uid):
                    summaries.append({**dict(r), 'summary': await db.fetchval('SELECT budgeting.get__crypto_position_entry_summary($1)', r['id'])})
            response = await client.get('/api/v1/crypto/protocol-positions')
            assert response.status_code == 200, response.text
            state.update(position_summaries=summaries, protocol_positions=response.json(), first_unimplemented_event=7, block_closed=False,
                         documented_funding_RUB=str(sum(Decimal(r.get('funding_RUB', '0')) for r in plan['rows'])))
            funding = Decimal(state['documented_funding_RUB'])
            held = sum(Decimal(str(p['summary']['remaining_cost_basis'])) for p in summaries)
            protocol_basis = sum(Decimal(str(p['cost_basis_in_base'])) for p in state['protocol_positions'])
            disposed = await sql("SELECT COALESCE(sum((metadata->>'consumed_cost_basis')::numeric),0) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND (event_type='fee' OR metadata->>'target_kind'='expense')", uid)
            assert held + protocol_basis + disposed == funding, (held, protocol_basis, disposed, funding)
            state['cost_reconciliation'] = dict(funding=str(funding), held=str(held), protocol=str(protocol_basis), disposed=str(disposed), difference='0.00')
            state['verified_through'] = last['event_no']
            save(state)
            print(json.dumps({k: state[k] for k in ('user_id','verified_through','documented_funding_RUB','first_unimplemented_event','block_closed')}, ensure_ascii=False))
    finally:
        await pool.close()


args.state.parent.mkdir(parents=True, exist_ok=True)
with args.state.with_suffix('.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    asyncio.run(main())
