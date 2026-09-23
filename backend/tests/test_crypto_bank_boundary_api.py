"""Real API + storage + SQL checks; isolated full-schema dev database only.

Usage: python -m backend.tests.test_crypto_bank_boundary_api SOCKET PORT DATABASE
Database must start with boundary_; no production credentials are loaded.
"""
import asyncio
from decimal import Decimal
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
assert sys.argv[3].startswith('boundary_')
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(socket),
                  DB_PORT=sys.argv[2], DB_DATABASE=sys.argv[3], DB_SCHEMA='budgeting',
                  POSTGRES_USER='audit', POSTGRES_PASSWORD='')

from fastapi import FastAPI  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    pool = await crypto.ledger._get_pool()
    try:
        async with pool.acquire() as db:
            uid = await db.fetchval("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
            await db.execute("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system')", uid)
            source = await db.fetchval("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,'API investment','investment','crypto') RETURNING id", uid)
            target = await db.fetchval("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'API cash') RETURNING id", uid)
            asset = await db.fetchval("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('ZZAPI','API boundary','testnet',$1,18) RETURNING id", str(uid))
            position = await db.fetchval("SELECT (budgeting.put__crypto_receive_reward($1,$2,$3,1.000000000000000001)->>'position_id')::bigint", uid, source, asset)
        app = FastAPI()
        app.include_router(crypto.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            body = dict(position_id=position, bank_account_id=target, amount='1.000000000000000001')
            response = await client.post('/api/v1/crypto/transfer-from-investment', json=body)
            assert response.status_code == 200, response.text
            assert response.json()['amount_in_base'] == 0
            async with pool.acquire() as db:
                assert await db.fetchval('SELECT amount FROM budgeting.current_crypto_balances WHERE bank_account_id=$1 AND crypto_asset_id=$2', target, asset) == Decimal(body['amount'])
                assert await db.fetchval('SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1', position) == 0
            response = await client.post('/api/v1/crypto/transfer-to-investment', json=dict(bank_account_id=target, investment_account_id=source, crypto_asset_id=asset, amount=body['amount']))
            assert response.status_code == 200, response.text
            new_position = response.json()['position_id']
            assert new_position != position
            async with pool.acquire() as db:
                assert await db.fetchval('SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1', new_position) == Decimal(body['amount'])
            for amount in ['NaN', 'Infinity', '0', '-1', '0.0000000000000000001']:
                response = await client.post('/api/v1/crypto/transfer-from-investment', json={**body, 'position_id': new_position, 'amount': amount})
                assert response.status_code == 422, response.text
            response = await client.post('/api/v1/crypto/transfer-from-investment', json={**body, 'position_id': new_position, 'value_in_base': '999'})
            assert response.status_code == 200, response.text
            assert response.json()['amount_in_base'] == 0, 'legacy observation must not create acquisition cost'
        print('bank_boundary_api: exact round trip, zero basis, legacy observation, 5 invalid inputs passed')
    finally:
        await pool.close()


asyncio.run(main())
