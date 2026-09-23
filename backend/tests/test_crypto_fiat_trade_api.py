"""Fiat trade integration through the source journal on an isolated full schema.

Usage: python -m backend.tests.test_crypto_fiat_trade_api SOCKET PORT DATABASE
"""
import asyncio
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

import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    pool = await crypto.ledger._get_pool()
    checks = []

    def check(name, ok):
        assert ok, name
        checks.append(name)

    async def sql(query, *args):
        async with pool.acquire() as db:
            return await db.fetchval(query, *args)

    try:
        uid = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
        cat = await sql("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system') RETURNING id", uid)
        inv = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,'Fiat investment','investment','crypto') RETURNING id", uid)
        bank = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'Fiat cash') RETURNING id", uid)
        asset = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ('ZZFIAT','Fiat test','testnet',$1,18) RETURNING id", str(uid))
        # Initial cash and unrelated banking crypto fixtures, not historical imports.
        op = await sql("INSERT INTO budgeting.operations(actor_user_id,owner_type,owner_user_id,type) VALUES ($1,'user',$1,'income') RETURNING id", uid)
        await sql("SELECT budgeting.put__apply_current_bank_delta($1,'RUB',10000,10000)", bank)
        await sql("SELECT budgeting.put__apply_current_budget_delta($1,'RUB',10000)", cat)
        await sql("INSERT INTO budgeting.bank_entries(operation_id,bank_account_id,currency_code,amount) VALUES ($1,$2,'RUB',10000) RETURNING id", op, bank)
        await sql("INSERT INTO budgeting.budget_entries(operation_id,category_id,currency_code,amount) VALUES ($1,$2,'RUB',10000) RETURNING id", op, cat)
        await sql("INSERT INTO budgeting.crypto_lots(bank_account_id,crypto_asset_id,amount_initial,amount_remaining,cost_base_initial,cost_base_remaining,opened_by_operation_id) VALUES ($1,$2,100,100,77,77,$3) RETURNING id", bank, asset, op)
        await sql("SELECT budgeting.put__apply_current_crypto_delta($1,$2,100,77)", bank, asset)
        app = FastAPI()
        app.include_router(crypto.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({'detail': str(exc)}, status_code=400)

        def command(kind, qty, money, **extra):
            return dict(kind=kind, payload=dict(investment_account_id=inv, bank_account_id=bank,
                crypto_asset_id=asset, quantity=qty, fiat_currency_code='RUB', fiat_amount=money, **extra))

        def envelope(key, order, commands):
            return dict(anchor_account_id=inv, source_namespace='fiat-test', source_id=key,
                occurred_at='2025-01-01T12:00:00Z', order_in_timestamp=order,
                accounting_date='2025-01-01', commands=commands)

        async def state():
            return await sql("""SELECT jsonb_build_object(
                'cash',(SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'),
                'budget',(SELECT amount FROM budgeting.current_budget_balances WHERE category_id=$2 AND currency_code='RUB'),
                'positions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM budgeting.portfolio_positions p WHERE investment_account_id=$3),
                'operations',(SELECT count(*) FROM budgeting.operations WHERE owner_user_id=$4),
                'sources',(SELECT count(*) FROM budgeting.crypto_source_events WHERE anchor_account_id=$3))""", bank, cat, inv, uid)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            async def post(body, status=200):
                response = await client.post('/api/v1/crypto/source-events', json=body)
                assert response.status_code == status, response.text
                return response.json()

            first = envelope('buy1', 0, [command('buy_fiat', '10', '1000')])
            result = await post(first)
            position = result['results'][0]['position_id']
            saved = await state()
            check('exact_retry', await post(first) == result and await state() == saved)
            check('cash_and_event_linked', {x['ledger_table'] for x in result['links']} == {'operations', 'portfolio_events'})
            await post(envelope('buy2', 1, [command('buy_fiat', '10', '2000')]))
            result = await post(envelope('sell', 2, [command('sell_fiat', '5', '900')]))
            check('weighted_average_sale_profit', result['results'][0]['cost_basis'] == 750 and result['results'][0]['realized_in_base'] == 150)
            summary = await sql('SELECT budgeting.get__crypto_position_entry_summary($1)', position)
            check('remaining_basis', summary['remaining_cost_basis'] == 2250 and summary['quantity_now'] == 15)
            values = await state()
            check('cash_budget_once', values['cash'] == 7900 and values['budget'] == 7900)
            check('old_bank_lot_untouched', await sql('SELECT amount_remaining=100 AND cost_base_remaining=77 FROM budgeting.crypto_lots WHERE bank_account_id=$1 AND crypto_asset_id=$2', bank, asset))
            saved = await state()
            await post(envelope('rollback', 3, [command('buy_fiat', '1', '100'), command('sell_fiat', '999', '100')]), 400)
            check('multi_command_rollback', await state() == saved)
            foreign = command('sell_fiat', '1', '100')
            foreign['payload']['fiat_currency_code'] = 'USD'
            await post(envelope('foreign', 3, [foreign]), 400)
            check('foreign_currency_no_fake_valuation', await state() == saved)
            await post(envelope('bad-money', 3, [command('buy_fiat', '1', '1.001')]), 400)
            await post(envelope('too-much', 3, [command('buy_fiat', '1', '100000')]), 400)
            check('invalid_money_and_insufficient_cash_rollback', await state() == saved)
            result = await post(envelope('full-sale', 3, [command('sell_fiat', '15', '2000')]))
            check('full_sale_closes_and_records_loss', result['results'][0]['realized_in_base'] == -250 and await sql('SELECT quantity=0 AND status=\'closed\' FROM budgeting.portfolio_positions WHERE id=$1', position))
            reward = dict(kind='reward', payload=dict(investment_account_id=inv, crypto_asset_id=asset, quantity='0.000000000000000001'))
            await post(envelope('reward', 4, [reward]))
            result = await post(envelope('free-sale', 5, [command('sell_fiat', '0.000000000000000001', '1')]))
            check('free_reward_sale_exact', result['results'][0]['cost_basis'] == 0 and result['results'][0]['realized_in_base'] == 1)
            result = await post(envelope('new-buy', 6, [command('buy_fiat', '1.000000000000000001', '100')]))
            position = result['results'][0]['position_id']
            check('new_purchase_exact', await sql('SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1', position) == Decimal('1.000000000000000001'))
            await sql("UPDATE budgeting.portfolio_events SET metadata=metadata||'{\"basis_quality\":\"estimated\"}'::jsonb WHERE position_id=$1", position)
            result = await post(envelope('estimated-sale', 7, [command('sell_fiat', '0.5', '60')]))
            check('estimated_quality_preserved', result['results'][0]['basis_quality'] == 'estimated' and result['results'][0]['cost_basis'] == 50)
            await sql("UPDATE budgeting.portfolio_events SET metadata=metadata||'{\"entry_value_in_base\":null,\"basis_quality\":\"unknown\"}'::jsonb WHERE position_id=$1", position)
            result = await post(envelope('unknown-sale', 8, [command('sell_fiat', '0.500000000000000001', '123')]))
            check('unknown_cost_real_proceeds', result['results'][0]['cost_basis'] is None and result['results'][0]['realized_in_base'] is None)
            check('all_historical_dates', await sql("SELECT bool_and(event_at='2025-01-01') FROM budgeting.portfolio_events WHERE position_id IN (SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1)", inv))
            other = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
            other_bank = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'Other cash') RETURNING id", other)
            bad = command('buy_fiat', '1', '1')
            bad['payload']['bank_account_id'] = other_bank
            saved = await state()
            await post(envelope('foreign-owner', 9, [bad]), 400)
            check('foreign_bank_owner_rejected', await state() == saved)
            family = await sql("INSERT INTO budgeting.families(name,base_currency_code,created_by_user_id) VALUES ('Fiat family','RUB',$1) RETURNING id", uid)
            await sql("INSERT INTO budgeting.family_members(family_id,user_id,role) VALUES ($1,$2,'owner') RETURNING user_id", family, uid)
            cat = await sql("INSERT INTO budgeting.categories(owner_type,owner_family_id,name,kind) VALUES ('family',$1,'Unallocated','system') RETURNING id", family)
            inv = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_family_id,name,account_kind,investment_asset_type) VALUES ('family',$1,'Family investment','investment','crypto') RETURNING id", family)
            bank = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_family_id,name) VALUES ('family',$1,'Family cash') RETURNING id", family)
            await sql("SELECT budgeting.put__apply_current_bank_delta($1,'RUB',10,10)", bank)
            await sql("SELECT budgeting.put__apply_current_budget_delta($1,'RUB',10)", cat)
            body = envelope('family-buy', 0, [command('buy_fiat', '1', '1')])
            results = await asyncio.gather(post(body), post(body))
            check('concurrent_family_retry', results[0] == results[1])
            operation = results[0]['results'][0]['operation_id']
            check('family_owner_from_accounts', await sql("SELECT owner_type='family' AND owner_family_id=$2 AND owner_user_id IS NULL FROM budgeting.operations WHERE id=$1", operation, family))
        print(json.dumps({'passed': len(checks), 'checks': checks}, indent=2))
    finally:
        await pool.close()


asyncio.run(main())
