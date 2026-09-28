"""Isolated per-event API verification of compiled main command templates.

SOCKET PORT boundary_DATABASE PLAN_JSON. Synthetic starting positions are NOT
personal opening balances. Each event gets a separate fixture user.
"""
import asyncio
from collections import defaultdict
from decimal import Decimal
import json
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
assert sys.argv[3].startswith('boundary_')
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(socket),
                  DB_PORT=sys.argv[2], DB_DATABASE=sys.argv[3], DB_SCHEMA='budgeting',
                  POSTGRES_USER='audit', POSTGRES_PASSWORD='')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/crypto'))

import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402
from compile_main_commands import bind_plan_commands  # noqa: E402


async def main():
    pool = await crypto.ledger._get_pool()
    plans = json.loads(await asyncio.to_thread(Path(sys.argv[4]).read_text))
    passed = []

    async def sql(query, *args):
        async with pool.acquire() as db:
            return await db.fetchval(query, *args)

    try:
        app = FastAPI()
        app.include_router(crypto.router)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({'detail': str(exc)}, status_code=400)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for plan in plans:
                if plan['blockers']:
                    continue
                uid = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
                app.dependency_overrides[get_current_user] = lambda uid=uid: CurrentUser(user_id=uid)
                await sql("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system') RETURNING id", uid)
                refs = set()

                def scan(x, refs=refs):
                    if isinstance(x, dict):
                        if 'resource_ref' in x:
                            refs.add(x['resource_ref'])
                        else:
                            for v in x.values():
                                scan(v)
                    elif isinstance(x, list):
                        for v in x:
                            scan(v)
                scan(plan['commands'])
                for command in plan['commands']:
                    if command['kind'] == 'sell_fiat':
                        master = command['payload']['crypto_asset_id']['resource_ref'][10:]
                        refs.add('position:main:ton:' + master)
                accounts = {'main'} | {k.split(':', 1)[1] for k in refs if k.startswith('account:')}
                positions = [k for k in refs if k.startswith('position:')]
                for key in positions:
                    wallet, master = key[9:].split(':ton:', 1)
                    accounts.add(wallet)
                    refs.add('asset:ton:' + master)
                bindings, asset_ids, account_ids = {}, {}, {}
                for wallet in sorted(accounts):
                    is_cash = wallet == 'primary_cash'
                    account = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,$2,$3,$4) RETURNING id", uid, 'FIXTURE ' + wallet, 'cash' if is_cash else 'investment', None if is_cash else 'crypto')
                    account_ids[wallet] = account
                    bindings['account:' + wallet] = account
                    if is_cash:
                        await sql("SELECT budgeting.put__apply_current_bank_delta($1,'RUB',1000000,1000000)", account)
                for key in sorted(k for k in refs if k.startswith('asset:')):
                    asset = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('TESTMAIN','Synthetic event fixture','testnet',$1,18) RETURNING id", str(uid) + ':' + key)
                    bindings[key] = asset
                    asset_ids[key[10:]] = asset
                initial = {}
                for key in positions:
                    wallet, master = key[9:].split(':ton:', 1)
                    position = await sql("INSERT INTO budgeting.portfolio_positions(owner_type,owner_user_id,investment_account_id,asset_type_code,title,quantity,amount_in_currency,currency_code,opened_at,metadata,created_by_user_id) VALUES ('user',$1,$2,'crypto','SYNTHETIC OPENING',1000000000,0,'RUB','2020-01-01',jsonb_build_object('crypto_asset_id',$3::bigint),$1) RETURNING id", uid, account_ids[wallet], asset_ids[master])
                    await sql("INSERT INTO budgeting.portfolio_events(position_id,event_type,event_at,quantity,amount,currency_code,metadata,created_by_user_id) VALUES ($1,'open','2020-01-01',1000000000,1000000,'RUB','{\"entry_value_in_base\":1000000,\"basis_quality\":\"known\"}'::jsonb,$2) RETURNING id", position, uid)
                    bindings[key] = position
                    initial[(wallet, master)] = Decimal(1000000000)
                commands = bind_plan_commands(plan, bindings)
                expected = defaultdict(Decimal, initial)
                for template in plan['commands']:
                    kind, p = template['kind'], template['payload']
                    if kind in ('fee', 'expense', 'swap', 'transfer'):
                        key = p.get('source_position_id', p.get('position_id'))['resource_ref']
                        wallet, master = key[9:].split(':ton:', 1)
                        expected[(wallet, master)] -= Decimal(p.get('quantity', p.get('from_amount', p.get('amount'))))
                        if kind == 'transfer':
                            target = p['target_investment_account_id']['resource_ref'][8:]
                            expected[(target, master)] += Decimal(p['amount'])
                        if kind == 'swap':
                            target = p['target_investment_account_id']['resource_ref'][8:]
                            expected[(target, p['to_crypto_asset_id']['resource_ref'][10:])] += Decimal(p['to_amount'])
                    else:
                        master = p['crypto_asset_id']['resource_ref'][10:]
                        expected[('main', master)] += Decimal(p['quantity']) * (-1 if kind == 'sell_fiat' else 1)
                body = dict(anchor_account_id=account_ids['main'], source_namespace='compiled-main-component',
                    source_id=plan['event_id'], occurred_at=plan['occurred_at'], accounting_date=plan['accounting_date'],
                    order_in_timestamp=int(plan['order_in_timestamp']), commands=commands,
                    evidence={'synthetic_opening_fixture': True, 'event_no': plan['event_no']})
                response = await client.post('/api/v1/crypto/source-events', json=body)
                assert response.status_code == 200, (plan['event_no'], response.text)
                result = response.json()
                for (wallet, master), qty in expected.items():
                    actual = await sql("SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", account_ids[wallet], str(asset_ids[master]))
                    assert actual == qty, (plan['event_no'], wallet, master, actual, qty)
                for cmd, _result_item in zip(commands, result['results'], strict=True):
                    if cmd['kind'] == 'swap':
                        target_asset = cmd['payload']['to_crypto_asset_id']
                        position = await sql("SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2", account_ids['main'], str(target_asset))
                        quality = await sql('SELECT budgeting.get__crypto_position_entry_summary($1)', position)
                        assert quality['basis_quality'] == 'unknown', (plan['event_no'], quality)
                before = await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1', uid)
                repeat = await client.post('/api/v1/crypto/source-events', json=body)
                assert repeat.status_code == 200 and repeat.json() == result
                assert await sql('SELECT count(*) FROM budgeting.portfolio_events WHERE created_by_user_id=$1', uid) == before
                passed.append(plan['event_no'])
        print(json.dumps({'events_passed': len(passed), 'event_numbers': passed,
            'checked': ['API accepts bound templates', 'exact per-account quantities', 'unknown swap basis remains unknown', 'idempotent retry'],
            'limitations': ['independent synthetic openings', 'not continuous personal replay', 'PostgreSQL 14']}, indent=2))
    finally:
        await pool.close()


asyncio.run(main())
