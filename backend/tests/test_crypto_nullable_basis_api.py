"""Real HTTP/storage/SQL chain on the disposable run_checks.py fixture only.

Run after the existing liquidation/accrual API checks. Synthetic identity.
"""
import asyncio
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
os.environ.update(APP_ENV='development', APP_PORT='8000', DB_HOST=str(socket),
                  DB_PORT=sys.argv[2], DB_DATABASE='postgres', DB_SCHEMA='budgeting',
                  POSTGRES_USER='audit', POSTGRES_PASSWORD='')

import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    app = FastAPI()
    app.include_router(crypto.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)

    @app.exception_handler(asyncpg.RaiseError)
    async def business_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=400)

    try:
        pool = await crypto.ledger._get_pool()
        # Reset accounting fixtures; identity and asset catalog remain intact.
        async with pool.acquire() as db:
            await db.execute('''TRUNCATE budgeting.portfolio_events,
                budgeting.portfolio_positions,budgeting.crypto_protocol_positions RESTART IDENTITY CASCADE;
                INSERT INTO budgeting.portfolio_positions
                (owner_type,owner_user_id,investment_account_id,asset_type_code,title,quantity,
                 amount_in_currency,currency_code,metadata,created_by_user_id)
                VALUES('user',1,1,'crypto','TON',200,0,'RUB',
                    '{"crypto_asset_id":1,"asset_symbol":"TON","network_code":"ton"}',1);
                INSERT INTO budgeting.portfolio_events(position_id,event_type,quantity,metadata,created_by_user_id)
                VALUES(1,'open',200,'{"entry_value_in_base":20000}',1);''')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            async def post(path, body):
                response = await client.post('/api/v1/crypto/'+path, json=body)
                assert response.status_code == 200, response.text
                return response.json()

            # Missing quote creates unknown acquisition cost, not carried old cost.
            swapped = await post('swap-investment-asset', dict(position_id=1, from_amount='20',
                to_crypto_asset_id=2, to_amount='40', operated_at='2025-01-01'))
            target = swapped['position_id']
            async with pool.acquire() as db:
                summary = await db.fetchval('SELECT budgeting.get__crypto_position_entry_summary($1)', target)
            assert summary['remaining_cost_basis'] is None and summary['basis_quality'] == 'unknown'
            # An explicit historical quote must name its source and date.
            quote = dict(position_id=1, from_amount='10', to_crypto_asset_id=2,
                         to_amount='20', value_in_base='1500', operated_at='2025-01-01')
            invalid = await client.post('/api/v1/crypto/swap-investment-asset', json=quote)
            assert invalid.status_code == 400
            await post('swap-investment-asset', {**quote, 'valuation_source': 'test historical execution'})
            protocol = await post('protocol-positions', dict(investment_account_id=1,
                protocol_name='HTTP audit', position_type='lending', asset_symbol='USDT',
                source_position_id=target, quantity='20', borrowed_crypto_asset_id=1,
                borrowed_quantity='10', deposited_at='2025-01-02'))
            assert protocol['cost_basis_in_base'] is None
            assert protocol['metadata']['debt_cost_basis_in_base'] is None
            url = f"protocol-positions/{protocol['id']}/"
            topped = await post(url+'top-up', dict(source_position_id=target, quantity='10'))
            assert topped['quantity'] == 30 and topped['cost_basis_in_base'] is None
            partial = await post(url+'partial-close', dict(principal_qty='5'))
            assert partial['quantity'] == 25 and partial['cost_basis_in_base'] is None
            accrual = dict(collateral_qty='0.000000000000000001', interest_qty='1',
                collateral_before='25', debt_before='10', external_id='unknown-http', operated_at='2025-01-03')
            await post(url+'accrue', accrual)
            await post(url+'accrue', accrual)
            repaid = await post(url+'repay-debt', dict(source_position_id=1, repay_qty='11', interest_qty='1'))
            assert repaid['metadata']['borrowed_quantity'] == 0
            assert repaid['metadata']['debt_cost_basis_in_base'] == 0
            closed = await post(url+'close', dict(return_quantity='25.000000000000000001'))
            assert closed['status'] == 'closed' and closed['cost_basis_in_base'] is None
            async with pool.acquire() as db:
                summary = await db.fetchval('SELECT budgeting.get__crypto_position_entry_summary($1)', target)
                exact = await db.fetchval('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=$1', target)
                pnl = await db.fetchval("SELECT realized_in_base FROM budgeting.crypto_liability_events WHERE event_kind='repayment'")
            assert summary['remaining_cost_basis'] is None and pnl is None
            assert exact == '60.000000000000000001', exact
            for bad in ('NaN', '-1', '0.0000000000000000001'):
                invalid = await client.post('/api/v1/crypto/'+url+'top-up', json=dict(source_position_id=target, quantity=bad))
                assert invalid.status_code == 422, invalid.text
    finally:
        await crypto.ledger.close()
    print('Swap -> collateral -> unknown loan/interest -> repayment -> exact return HTTP chain passed.')


if __name__ == '__main__':
    asyncio.run(main())
