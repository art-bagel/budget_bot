"""API component replay of cash sources; NOT the owner's complete historical replay.

Uses synthetic opening cash, test-only assets, and arbitrary within-day order.
Only run on the disposable local boundary test cluster. Arguments:
SOCKET PORT DATABASE CASH_PLAN_JSON CARD_CONVERSIONS_JSON
"""
import asyncio
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import hashlib
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
    inputs = []

    def read(arg):
        path = Path(arg).resolve()
        raw = path.read_bytes()
        inputs.append({'name': path.name, 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    cash = read(sys.argv[4])
    cards = read(sys.argv[5])
    pool = await crypto.ledger._get_pool()
    checks = []

    def check(name, condition):
        assert condition, name
        checks.append(name)

    async def sql(query, *args):
        async with pool.acquire() as db:
            return await db.fetchval(query, *args)

    try:
        uid = await sql("INSERT INTO budgeting.users(base_currency_code) VALUES ('RUB') RETURNING id")
        cat = await sql("INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES ('user',$1,'Unallocated','system') RETURNING id", uid)
        inv = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES ('user',$1,'COMPONENT TEST ONLY','investment','crypto') RETURNING id", uid)
        bank = await sql("INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES ('user',$1,'SYNTHETIC FUNDING ONLY') RETURNING id", uid)
        assets = {}
        for symbol in sorted({r['asset'] for r in cash} | {s for r in cards for s in r['crypto_debits']}):
            assets[symbol] = await sql("INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES ($1,'Component test asset','testnet',$2,18) RETURNING id", 'TEST_' + symbol, str(uid) + ':' + symbol)
        funding = sum(Decimal(r['fiat_amount']) for r in cash if r['direction'] == 'buy_fiat')
        op = await sql("INSERT INTO budgeting.operations(actor_user_id,owner_type,owner_user_id,type,comment) VALUES ($1,'user',$1,'income','SYNTHETIC COMPONENT FIXTURE NOT OWN FUNDING') RETURNING id", uid)
        await sql("INSERT INTO budgeting.bank_entries(operation_id,bank_account_id,currency_code,amount) VALUES ($1,$2,'RUB',$3) RETURNING id", op, bank, funding)
        await sql("INSERT INTO budgeting.budget_entries(operation_id,category_id,currency_code,amount) VALUES ($1,$2,'RUB',$3) RETURNING id", op, cat, funding)
        await sql("SELECT budgeting.put__apply_current_bank_delta($1,'RUB',$2,$2)", bank, funding)
        await sql("SELECT budgeting.put__apply_current_budget_delta($1,'RUB',$2)", cat, funding)
        app = FastAPI()
        app.include_router(crypto.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({'detail': str(exc)}, status_code=400)

        rows = []
        for row in cash:
            rows.append((row['date_as_in_source'], row['source_key'], row, False))
        for row in cards:
            assert len(row['crypto_debits']) == 1, 'Multi-asset card valuation needs allocation'
            rows.append((row['date'], row['source_key'], row, True))
        rows.sort(key=lambda x: (x[0], x[1]))
        assert len({r[1] for r in rows}) == len(rows)
        expected = defaultdict(lambda: {'quantity': Decimal(0), 'cost': Decimal(0), 'estimated': False})
        requests, results = [], []
        dates = defaultdict(int)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            async def post(body):
                response = await client.post('/api/v1/crypto/source-events', json=body)
                assert response.status_code == 200, response.text
                return response.json()

            for date, key, row, is_card in rows:
                if is_card:
                    symbol, quantity = next(iter(row['crypto_debits'].items()))
                    amount = row['pending_manual_amount']
                    kind, currency = 'sell_fiat', 'USD'
                    extra = dict(historical_value_in_base=row['historical_value_in_base'],
                                 valuation_source=row['valuation_source'], defer_manual_expense=True)
                else:
                    symbol, quantity, amount = row['asset'], row['quantity'], row['fiat_amount']
                    kind, currency = row['direction'], row['currency']
                    extra = {} if kind == 'sell_fiat' else dict(purchase_quality=row['basis_quality'],
                        purchase_source=json.dumps(row['evidence'], ensure_ascii=False, sort_keys=True))
                body = dict(anchor_account_id=inv, source_namespace='cash-component-test', source_id=key,
                    occurred_at=date + 'T12:00:00Z', order_in_timestamp=dates[date], accounting_date=date,
                    evidence=dict(component_test_only=True, within_day_order='synthetic_not_historical', inputs=inputs),
                    commands=[dict(kind=kind, payload=dict(investment_account_id=inv, bank_account_id=bank,
                        crypto_asset_id=assets[symbol], quantity=quantity, fiat_currency_code=currency,
                        fiat_amount=amount, **extra))])
                dates[date] += 1
                result = await post(body)
                requests.append(body)
                results.append(result)
                actual = result['results'][0]
                book = expected[symbol]
                qty = Decimal(quantity)
                if kind == 'buy_fiat':
                    book['quantity'] += qty
                    book['cost'] += Decimal(amount)
                    book['estimated'] |= row['basis_quality'] == 'estimated'
                    check(key + ':purchase_quality', actual['basis_quality'] == row['basis_quality'])
                else:
                    cost = (book['cost'] * qty / book['quantity']).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
                    value = Decimal(row['historical_value_in_base'] if is_card else amount)
                    check(key + ':disposal_basis_profit', Decimal(str(actual['cost_basis'])) == cost
                          and Decimal(str(actual['realized_in_base'])) == value - cost
                          and actual['basis_quality'] == ('estimated' if book['estimated'] else 'known'))
                    book['cost'] -= cost
                    book['quantity'] -= qty
                summary = await sql('SELECT budgeting.get__crypto_position_entry_summary($1)', actual['position_id'])
                check(key + ':position', Decimal(str(summary['quantity_now'])) == book['quantity']
                      and Decimal(str(summary['remaining_cost_basis'])) == book['cost']
                      and summary['basis_quality'] == ('estimated' if book['estimated'] else 'known'))
            snapshot_query = """SELECT jsonb_build_object(
                'bank',(SELECT jsonb_agg(to_jsonb(b) ORDER BY currency_code) FROM budgeting.current_bank_balances b WHERE bank_account_id=$1),
                'positions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM budgeting.portfolio_positions p WHERE investment_account_id=$2),
                'events',(SELECT count(*) FROM budgeting.crypto_source_events WHERE anchor_account_id=$2),
                'operations',(SELECT count(*) FROM budgeting.operations WHERE owner_user_id=$3))"""
            snapshot = await sql(snapshot_query, bank, inv, uid)
            for body, result in zip(requests, results, strict=True):
                check(body['source_id'] + ':repeat', await post(body) == result)
            check('complete_repeat_changes_nothing', await sql(snapshot_query, bank, inv, uid) == snapshot)
            pending = (await client.get('/api/v1/crypto/pending-fiat-expenses?limit=200')).json()
            check('all_card_proceeds_pending', len(pending) == len(cards)
                  and sum(Decimal(r['amount']) for r in pending) == sum(Decimal(r['pending_manual_amount']) for r in cards))
            check('no_automatic_expenses', await sql("SELECT count(*)=0 FROM budgeting.operations WHERE owner_user_id=$1 AND type='expense'", uid))
            check('rub_cash_equals_sales_after_synthetic_funding_consumed', await sql("SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='RUB'", bank) == sum(Decimal(r['fiat_amount']) for r in cash if r['direction'] == 'sell_fiat'))
            check('usd_cash_and_basis', await sql("SELECT amount=1157.80 AND historical_cost_in_base=92021.40 FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='USD'", bank))
            check('estimated_events_preserve_cash_evidence', await sql("SELECT count(*)=12 AND sum(amount)=322755.42 AND bool_and(metadata->>'fiat_amount_quality'='estimated' AND metadata->>'purchase_source' IS NOT NULL) FROM budgeting.portfolio_events WHERE position_id IN (SELECT id FROM budgeting.portfolio_positions WHERE investment_account_id=$1) AND metadata->>'action'='fiat_buy' AND metadata->>'basis_quality'='estimated'", inv))
        print(json.dumps({'status': 'component_test_passed_not_full_history', 'events': len(rows),
            'purchases': sum(r['direction'] == 'buy_fiat' for r in cash), 'friend_sales': sum(r['direction'] == 'sell_fiat' for r in cash),
            'card_conversions': len(cards), 'passed': len(checks), 'checks': checks, 'inputs': inputs,
            'limitations': ['synthetic_cash_funding', 'test_asset_identity', 'arbitrary_within_day_order',
                            'omits_swaps_rewards_transfers_loans_protocols', 'not_personal_balances_or_cost_basis']}, indent=2))
    finally:
        await pool.close()


asyncio.run(main())
