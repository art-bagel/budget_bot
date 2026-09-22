"""HTTP -> real storage/SQL checks on the disposable crypto audit fixture.

Run after run_checks.py and optionally test_crypto_liquidation_api:
python -m backend.tests.test_crypto_accrual_api SOCKET PORT
Synthetic authentication; no application lifespan or external notifications.
"""
import asyncio
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
port = int(sys.argv[2])
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(socket),
                  DB_PORT=str(port), DB_DATABASE='postgres', DB_SCHEMA='budgeting',
                  POSTGRES_USER='audit', POSTGRES_PASSWORD='')

import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    app = FastAPI()
    app.include_router(crypto.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)

    @app.exception_handler(asyncpg.RaiseError)
    async def business_error(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail': str(exc)}, status_code=400)

    try:
        pool = await crypto.ledger._get_pool()
        async with pool.acquire() as connection:
            initial = await connection.fetchrow("SELECT quantity::text,metadata->>'borrowed_quantity' AS debt,cost_basis_in_base FROM budgeting.crypto_protocol_positions WHERE id=1")
        body = dict(collateral_qty='0.000000000000000001', interest_qty='0.1',
                    interest_value_in_base='10.00', collateral_before=initial['quantity'],
                    debt_before=initial['debt'], external_id='http-accrual', operated_at='2025-01-05')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            url = '/api/v1/crypto/protocol-positions/1/accrue'
            response = await client.post(url, json=body)
            assert response.status_code == 200, response.text
            again = await client.post(url, json=body)
            assert again.json() == response.json()
            conflict = await client.post(url, json={**body, 'interest_qty': '0.2'})
            assert conflict.status_code == 400
            async with pool.acquire() as connection:
                exact = await connection.fetchval("SELECT collateral_quantity::text FROM budgeting.crypto_protocol_accrual_events WHERE external_id='http-accrual'")
                basis = await connection.fetchval('SELECT cost_basis_in_base FROM budgeting.crypto_protocol_positions WHERE id=1')
            assert exact == '0.000000000000000001' and basis == initial['cost_basis_in_base']
            for bad in ('NaN', '-1', '0.0000000000000000001'):
                invalid = await client.post(url, json={**body, 'collateral_qty': bad})
                assert invalid.status_code == 422
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=2)
            forbidden = await client.post(url, json=body)
            assert forbidden.status_code == 400 and 'Access denied' in forbidden.text
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
            # Fixture mutation creates a missing acquisition price, not a zero.
            async with pool.acquire() as connection:
                await connection.execute("UPDATE budgeting.portfolio_events SET metadata=jsonb_set(metadata,'{entry_value_in_base}','null') WHERE position_id=1 AND event_type='open'")
            transferred = await client.post('/api/v1/crypto/transfer-between-investment-accounts', json={
                'position_id': 1, 'target_investment_account_id': 2, 'amount': '2.000000000000000001'})
            assert transferred.status_code == 200, transferred.text
            target = transferred.json()['position_id']
            fee = await client.post(f'/api/v1/crypto/asset-positions/{target}/pay-fee', json={'quantity': '0.000000000000000001'})
            assert fee.status_code == 200 and fee.json()['consumed_cost_basis'] is None, fee.text
            assert fee.json()['basis_quality'] == 'unknown'
            async with pool.acquire() as connection:
                summary = await connection.fetchval('SELECT budgeting.get__crypto_position_entry_summary($1)', target)
                exact = await connection.fetchval('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=$1', target)
            assert summary['basis_quality'] == 'unknown' and summary['remaining_cost_basis'] is None
            assert exact == '2.000000000000000000'
    finally:
        await crypto.ledger.close()
    print('Accrual and unknown-basis transfer/fee HTTP checks passed (synthetic identity).')


if __name__ == '__main__':
    asyncio.run(main())
