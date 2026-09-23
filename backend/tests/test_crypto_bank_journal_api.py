"""Bank exchange and portfolio transfer via the journal, disposable dev only."""
import asyncio
from decimal import Decimal
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
                occurred_at=f'2024-01-{n:02}T12:00:00Z', accounting_date=f'2024-01-{n:02}', order_in_timestamp=0, commands=commands)

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
        print('bank_journal_api: bank-only exchange, exact 18 decimals, cost-preserving transfer, atomic rollback, 7 invalid cases and idempotent batch passed')
    finally:
        await pool.close()


asyncio.run(main())
