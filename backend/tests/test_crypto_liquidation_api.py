"""Run after crypto_accounting/run_checks.py on its disposable DB only.

Real HTTP router -> Ledger -> PostgreSQL. Authentication is replaced with a
synthetic principal; this does not test login or the full application's lifespan.
Usage: python -m backend.tests.test_crypto_liquidation_api SOCKET PORT
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

    body = dict(collateral_qty='10.000000000000000001', debt_qty='10',
                external_id='http-liquidation', operated_at='2025-01-04')
    url = '/api/v1/crypto/protocol-positions/1/liquidate'
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            first = await client.post(url, json=body)
            assert first.status_code == 200, first.text
            assert first.json()['realized_in_base'] == -200
            # Numeric input must reach PostgreSQL without a float conversion.
            pool = await crypto.ledger._get_pool()
            async with pool.acquire() as connection:
                exact = await connection.fetchval("SELECT metadata->'request'->>'collateral_quantity' FROM budgeting.crypto_liability_events WHERE external_id='http-liquidation'")
            assert exact == body['collateral_qty'], exact
            retry = await client.post(url, json=body)
            assert retry.json() == first.json()
            conflict = await client.post(url, json={**body, 'debt_qty': '11'})
            assert conflict.status_code == 400
            for bad in ('NaN', '0', '-1', '0.0000000000000000001'):
                response = await client.post(url, json={**body, 'collateral_qty': bad})
                assert response.status_code == 422, response.text
            response = await client.post(url, json={**body, 'external_id': ' '})
            assert response.status_code == 422
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=2)
            response = await client.post(url, json=body)
            assert response.status_code == 400 and 'Access denied' in response.text
    finally:
        await crypto.ledger.close()
    print('Liquidation HTTP/storage/SQL checks passed (synthetic identity).')


if __name__ == '__main__':
    asyncio.run(main())
