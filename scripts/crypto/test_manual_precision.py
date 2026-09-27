"""Opt-in local Docker preview API/SQL checks, all financial writes rolled back."""
import os
import unittest
from decimal import Decimal as D
from unittest.mock import patch

from prepare_docker_history import ROOT, UID, connect


@unittest.skipUnless(os.environ.get('CRYPTO_TEST_DOCKER_PREVIEW') == '1', 'Local preview only')
class ManualPrecisionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ.setdefault('APP_PORT', '8000')
        os.environ.setdefault('DB_PORT', '5432')
        from backend.app.dependencies import CurrentUser, get_current_user
        from backend.app.routers import crypto, operations, portfolio
        from fastapi import FastAPI
        import httpx

        self.db = await connect()
        self.addAsyncCleanup(self.db.close)
        self.tx = self.db.transaction()
        await self.tx.start()
        async def rollback():
            await self.tx.rollback()
        self.addAsyncCleanup(rollback)
        for name in ('put__record_crypto_expense', 'put__record_portfolio_income', 'put__swap_crypto_investment_asset', 'put__manual_crypto_movement', 'get__portfolio_positions', 'get__portfolio_position'):
            await self.db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{name}.sql').read_text())
        self.position = await self.db.fetchrow("""select p.id, p.quantity, p.metadata,
            (p.metadata->>'crypto_asset_id')::bigint asset_id
            from budgeting.portfolio_positions p join budgeting.crypto_assets a
            on a.id=(p.metadata->>'crypto_asset_id')::bigint
            where p.owner_user_id=$1 and p.status='open' and a.symbol='JETTON'
            order by p.quantity desc limit 1""", UID)
        self.assertIsNotNone(self.position)
        self.app = FastAPI()
        for router in (portfolio.router, operations.router, crypto.router):
            self.app.include_router(router)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=UID)
        # Keep the real route and storage argument binding, but every call shares
        # this rollback transaction instead of acquiring a production-style pool.
        async def call(function, *args):
            placeholders = ','.join(f'${i+1}' for i in range(len(args)))
            async with self.db.transaction():
                return await self.db.fetchval(f'SELECT {function}({placeholders})', *args)
        self.patcher = patch.object(portfolio.ledger, 'call_function', side_effect=call)
        self.patcher.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.patcher.stop()

    async def summary(self):
        return await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', self.position['id'])

    async def reward(self, quantity):
        return await self.client.post(f"/api/v1/portfolio/positions/{self.position['id']}/income", json=dict(
            amount=0, currency_code='RUB', quantity=quantity, income_kind='reward',
            destination='position', received_at='2026-09-07'))

    async def test_reward_exact_quantity_dilutes_cost_preserves_funding_and_date(self):
        # The live wallet's JETTON can consist solely of zero-cost rewards.
        # Add a controlled historical-cost fixture inside this rollback transaction.
        await self.db.execute("""insert into budgeting.portfolio_events
            (position_id,event_type,event_at,quantity,metadata,created_by_user_id)
            values ($1,'top_up','2026-09-06',0,'{\"entry_value_in_base\":1000}', $2)""", self.position['id'], UID)
        before = await self.summary()
        quantity = '1.123456789012345678'
        response = await self.reward(quantity)
        self.assertEqual(response.status_code, 200, response.text)
        after = await self.summary()
        actual = await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1', self.position['id'])
        self.assertEqual(actual - self.position['quantity'], D(quantity))
        self.assertEqual(before['remaining_cost_basis'], after['remaining_cost_basis'])
        self.assertEqual(before['funding_units'], after['funding_units'])
        self.assertLess(D(str(after['avg_cost_per_unit'])), D(str(before['avg_cost_per_unit'])))
        operation = response.json()['operation_id']
        self.assertEqual(str(await self.db.fetchval('select operated_on from budgeting.operations where id=$1', operation)), '2026-09-07')

    async def test_manual_swap_after_reward_carries_cost(self):
        await self.test_reward_exact_quantity_dilutes_cost_preserves_funding_and_date()
        before = await self.summary()
        if before['funding_units']:
            self.skipTest('Funded position uses journal; guard tested separately')
        asset = await self.db.fetchval("""select a.id from budgeting.crypto_assets a
            where a.id<>$2 and not exists(select 1 from budgeting.portfolio_positions p
              where p.investment_account_id=(select investment_account_id from budgeting.portfolio_positions where id=$1)
              and p.status='open' and p.metadata->>'crypto_asset_id'=a.id::text)
            order by a.id limit 1""", self.position['id'], self.position['asset_id'])
        response = await self.client.post('/api/v1/crypto/swap-investment-asset', json=dict(
            position_id=self.position['id'], from_amount='1.123456789012345678',
            to_crypto_asset_id=asset, to_amount='0.123456789012345678', operated_at='2026-09-08',
            value_in_base='999999', valuation_source='legacy observation'))
        self.assertEqual(response.status_code, 200, response.text)
        after = await self.summary()
        operation = response.json()['operation_id']
        movements = await self.db.fetch("select event_type,quantity,metadata from budgeting.portfolio_events where linked_operation_id=$1", operation)
        incoming = next(e for e in movements if e['event_type']=='swap_in')
        outgoing = next(e for e in movements if e['event_type']=='swap_out')
        self.assertEqual(abs(incoming['quantity']), D('0.123456789012345678'))
        self.assertEqual(abs(outgoing['quantity']), D('1.123456789012345678'))
        self.assertEqual(D(str(incoming['metadata']['entry_value_in_base'])), D(str(outgoing['metadata']['consumed_cost_basis'])))
        self.assertEqual(D(str(before['remaining_cost_basis'])) - D(str(after['remaining_cost_basis'])), D(str(incoming['metadata']['entry_value_in_base'])))

    async def test_unknown_cost_remains_unknown_despite_market_observation(self):
        await self.db.execute("update budgeting.portfolio_positions set metadata=metadata || '{\"basis_quality\":\"unknown\"}'::jsonb where id=$1", self.position['id'])
        asset = await self.db.fetchval("""select a.id from budgeting.crypto_assets a
            where a.id<>$2 and not exists(select 1 from budgeting.portfolio_positions p
              where p.investment_account_id=(select investment_account_id from budgeting.portfolio_positions where id=$1)
              and p.status='open' and p.metadata->>'crypto_asset_id'=a.id::text)
            order by a.id limit 1""", self.position['id'], self.position['asset_id'])
        response = await self.client.post('/api/v1/crypto/swap-investment-asset', json=dict(
            position_id=self.position['id'], from_amount='0.1', to_crypto_asset_id=asset,
            to_amount='1', operated_at='2026-09-08', value_in_base='999999', valuation_source='observation'))
        self.assertEqual(response.status_code, 200, response.text)
        incoming = await self.db.fetchval("select metadata from budgeting.portfolio_events where linked_operation_id=$1 and event_type='swap_in'", response.json()['operation_id'])
        self.assertIsNone(incoming['entry_value_in_base'])
        self.assertEqual(incoming['basis_quality'], 'unknown')

    async def test_funded_direct_sql_swap_still_rejects_without_journal(self):
        import asyncpg
        funded = await self.db.fetchrow("""select id,quantity,metadata from budgeting.portfolio_positions
            where owner_user_id=$1 and status='open' and quantity>1
            and coalesce(metadata->'funding_units','{}')<>'{}'::jsonb limit 1""", UID)
        self.assertIsNotNone(funded, 'Imported history must retain open financing')
        asset = await self.db.fetchval("select id from budgeting.crypto_assets where id<>$1 order by id limit 1", int(funded['metadata']['crypto_asset_id']))
        with self.assertRaisesRegex(asyncpg.RaiseError, 'заёмным финансированием'):
            async with self.db.transaction():
                await self.db.fetchval('select budgeting.put__swap_crypto_investment_asset($1,$2,0.1,$3,1)',
                                       UID, funded['id'], asset)
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1', funded['id']), funded['quantity'])

    async def test_reward_invalid_precision_nonfinite_and_owner_rejected(self):
        for quantity in ('0', '-1', 'NaN', 'Infinity', '0.0000000000000000001'):
            response = await self.reward(quantity)
            self.assertEqual(response.status_code, 422, response.text)
        from backend.app.dependencies import CurrentUser, get_current_user
        import asyncpg
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'Access denied'):
            await self.reward('1')
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1', self.position['id']), self.position['quantity'])

    async def test_existing_journal_funded_swap_is_repeatable(self):
        from datetime import date, datetime, timezone
        funded = await self.db.fetchrow("""select id,metadata from budgeting.portfolio_positions
            where owner_user_id=$1 and status='open' and quantity>1
            and coalesce(metadata->'funding_units','{}')<>'{}'::jsonb
            and metadata->>'crypto_asset_id'<>$2 order by id limit 1""", UID, str(self.position['asset_id']))
        self.assertIsNotNone(funded)
        commands = [dict(kind='swap', payload=dict(position_id=funded['id'],
            from_amount='0.1', to_crypto_asset_id=self.position['asset_id'],
            to_amount='1.123456789012345678', basis_policy='carry'))]
        args = (UID, datetime(2090,1,1,tzinfo=timezone.utc), date(2090,1,1), commands)
        sql = "select budgeting.put__crypto_source_event($1,92,'r2-regression','funded-swap',$2,0,$3,$4,'{}')"
        first = await self.db.fetchval(sql, *args)
        self.assertEqual(first, await self.db.fetchval(sql, *args))
        result = first['results'][0]
        self.assertEqual(result['basis_policy'], 'carry')
        self.assertIn('funding', result)

    async def funded_source(self):
        row = await self.db.fetchrow("""select id,quantity,metadata,investment_account_id
            from budgeting.portfolio_positions where owner_user_id=$1 and status='open'
            and quantity>1 and coalesce(metadata->'funding_units','{}')<>'{}'::jsonb
            and metadata->>'crypto_asset_id'<>$2 order by id limit 1""", UID, str(self.position['asset_id']))
        self.assertIsNotNone(row)
        return row

    async def test_manual_funded_swap_transfer_fee_and_repeat(self):
        from uuid import uuid4
        funded = await self.funded_source()
        body = dict(request_id=str(uuid4()), position_id=funded['id'],
                    from_amount='0.123456789012345678', to_crypto_asset_id=self.position['asset_id'],
                    to_amount='1.123456789012345678', operated_at='2026-09-08',
                    fee=dict(source_position_id=funded['id'], quantity='0.001'))
        path = '/api/v1/crypto/swap-investment-asset'
        response = await self.client.post(path, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), (await self.client.post(path, json=body)).json())
        self.assertEqual(funded['quantity'] - await self.db.fetchval(
            'select quantity from budgeting.portfolio_positions where id=$1', funded['id']), D('0.124456789012345678'))
        event = await self.db.fetchval("select result from budgeting.crypto_source_events where source_id=$1", body['request_id'])
        self.assertEqual(len(event['results']), 2)
        self.assertEqual(event['results'][0]['basis_policy'], 'carry')
        self.assertIn('funding', event['results'][1])
        incoming = await self.db.fetchrow("""select e.position_id,e.quantity,e.metadata from budgeting.portfolio_events e
            where linked_operation_id=$1 and event_type='swap_in'""", response.json()['operation_id'])
        self.assertEqual(incoming['quantity'], D(body['to_amount']))
        self.assertTrue(await self.db.fetchval("select metadata->'funding_units' from budgeting.portfolio_positions where id=$1", incoming['position_id']))
        account = await self.db.fetchval("""select id from budgeting.bank_accounts where owner_user_id=$1
            and account_kind='investment' and investment_asset_type='crypto'
            and provider_name is distinct from 'reconstruction_internal' and is_active
            and id<>$2 order by id limit 1""", UID, funded['investment_account_id'])
        transfer = dict(request_id=str(uuid4()), position_id=incoming['position_id'],
                        target_investment_account_id=account, amount='0.123456789012345678', operated_at='2026-09-08')
        moved = await self.client.post('/api/v1/crypto/transfer-between-investment-accounts', json=transfer)
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual(moved.json(), (await self.client.post('/api/v1/crypto/transfer-between-investment-accounts', json=transfer)).json())
        events = await self.db.fetch("select event_type,quantity,metadata from budgeting.portfolio_events where linked_operation_id=$1", moved.json()['operation_id'])
        outgoing = next(e for e in events if e['event_type']=='transfer_out')
        received = next(e for e in events if e['event_type']=='transfer_in')
        self.assertEqual(abs(received['quantity']), D(transfer['amount']))
        self.assertEqual(outgoing['metadata']['consumed_cost_basis'], received['metadata']['entry_value_in_base'])
        # Retrying an older request after a newer one must still return its original receipt.
        self.assertEqual(response.json(), (await self.client.post(path, json=body)).json())

    async def test_manual_atomic_failure_and_changed_key(self):
        import asyncpg
        from uuid import uuid4
        from check_user_history import fingerprint
        funded = await self.funded_source()
        body = dict(request_id=str(uuid4()), position_id=funded['id'],
                    from_amount='0.1', to_crypto_asset_id=self.position['asset_id'],
                    to_amount='1', operated_at='2026-09-08',
                    fee=dict(source_position_id=funded['id'], quantity='999999999'))
        before = await fingerprint(self.db)
        with self.assertRaises(asyncpg.RaiseError):
            await self.client.post('/api/v1/crypto/swap-investment-asset', json=body)
        self.assertEqual(before, await fingerprint(self.db))
        body.pop('fee')
        self.assertEqual((await self.client.post('/api/v1/crypto/swap-investment-asset', json=body)).status_code, 200)
        before = await fingerprint(self.db)
        body['to_amount'] = '2'
        with self.assertRaisesRegex(asyncpg.RaiseError, 'другими данными'):
            await self.client.post('/api/v1/crypto/swap-investment-asset', json=body)
        self.assertEqual(before, await fingerprint(self.db))

    async def test_manual_date_owner_and_precision_guards(self):
        import asyncpg
        from uuid import uuid4
        funded = await self.funded_source()
        body = dict(request_id=str(uuid4()), position_id=funded['id'],
                    from_amount='0.1', to_crypto_asset_id=self.position['asset_id'],
                    to_amount='1', operated_at='2024-01-01')
        path = '/api/v1/crypto/swap-investment-asset'
        with self.assertRaisesRegex(asyncpg.RaiseError, 'пересчёт'):
            await self.client.post(path, json=body)
        body['operated_at'] = '2026-09-08'
        for value in ('0', '-1', 'NaN', 'Infinity', '0.0000000000000000001'):
            self.assertEqual((await self.client.post(path, json={**body, 'from_amount':value})).status_code, 422)
        from backend.app.dependencies import CurrentUser, get_current_user
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'Нет доступа'):
            await self.client.post(path, json=body)

    async def test_new_user_without_import_can_swap_and_transfer_full_balance(self):
        from uuid import uuid4
        from backend.app.dependencies import CurrentUser, get_current_user
        uid = 900000000000 + uuid4().int % 1000000000
        await self.db.execute("insert into budgeting.users(id,base_currency_code) values($1,'RUB')", uid)
        accounts = []
        for name in ('Wallet A', 'Wallet B'):
            accounts.append(await self.db.fetchval("""insert into budgeting.bank_accounts
                (owner_type,owner_user_id,name,account_kind,investment_asset_type)
                values('user',$1,$2,'investment','crypto') returning id""", uid, name))
        reward = await self.db.fetchval("""select budgeting.put__crypto_receive_reward(
            $1,$2,$3,10.123456789012345678,NULL,'2026-09-08')""", uid, accounts[0], self.position['asset_id'])
        target_asset = await self.db.fetchval('select id from budgeting.crypto_assets where id<>$1 order by id limit 1', self.position['asset_id'])
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)
        body = dict(request_id=str(uuid4()), position_id=reward['position_id'],
                    from_amount='10.123456789012345678', to_crypto_asset_id=target_asset,
                    to_amount='0.123456789012345678', operated_at='2026-09-08')
        swapped = await self.client.post('/api/v1/crypto/swap-investment-asset', json=body)
        self.assertEqual(swapped.status_code, 200, swapped.text)
        incoming = await self.db.fetchval("select position_id from budgeting.portfolio_events where linked_operation_id=$1 and event_type='swap_in'", swapped.json()['operation_id'])
        transfer = dict(request_id=str(uuid4()), position_id=incoming,
                        target_investment_account_id=accounts[1], amount=body['to_amount'], operated_at='2026-09-08')
        path = '/api/v1/crypto/transfer-between-investment-accounts'
        moved = await self.client.post(path, json=transfer)
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual(moved.json(), (await self.client.post(path, json=transfer)).json())
        self.assertEqual(swapped.json(), (await self.client.post('/api/v1/crypto/swap-investment-asset', json=body)).json())
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1', incoming), D(0))
        self.assertEqual(await self.db.fetchval('select sum(quantity) from budgeting.portfolio_positions where investment_account_id=$1', accounts[1]), D(body['to_amount']))

    async def test_exact_balance_read(self):
        from backend.app.routers.portfolio import PortfolioPositionItem
        raw = await self.db.fetchval('select budgeting.get__portfolio_position($1,$2)', UID, self.position['id'])
        parsed = PortfolioPositionItem(**raw)
        self.assertEqual(D(parsed.quantity_exact), self.position['quantity'])
        rows = await self.db.fetchval('select budgeting.get__portfolio_positions($1)', UID)
        selected = next(r for r in rows if r['id']==self.position['id'])
        self.assertEqual(D(PortfolioPositionItem(**selected).quantity_exact), self.position['quantity'])

    async def test_bank_expense_preserves_all_18_decimals_and_cost(self):
        # Existing excursion reserve: no fictional funding or new income needed.
        asset = 15
        quantity = '0.123456789012345678'
        before = await self.db.fetchval('select amount from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id=$1', asset)
        response = await self.client.post('/api/v1/operations/expense', json=dict(
            bank_account_id=73, category_id=90, crypto_asset_id=asset, amount=quantity,
            operated_at='2026-09-07', comment='Rollback-only precision check'))
        self.assertEqual(response.status_code, 200, response.text)
        after = await self.db.fetchval('select amount from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id=$1', asset)
        self.assertEqual(before-after, D(quantity))
        op = response.json()['operation_id']
        consumed = await self.db.fetchval('select sum(amount) from budgeting.crypto_lot_consumptions where operation_id=$1', op)
        self.assertEqual(consumed, D(quantity))
        cost = await self.db.fetchval('select sum(cost_base) from budgeting.crypto_lot_consumptions where operation_id=$1', op)
        self.assertEqual(cost, D(str(response.json()['expense_cost_in_base'])))
        for value in ('0.0000000000000000001', 'NaN', 'Infinity', '-1', '0'):
            bad = await self.client.post('/api/v1/operations/expense', json=dict(bank_account_id=73, category_id=90, crypto_asset_id=asset, amount=value))
            self.assertEqual(bad.status_code, 422, bad.text)


if __name__ == '__main__':
    unittest.main()
