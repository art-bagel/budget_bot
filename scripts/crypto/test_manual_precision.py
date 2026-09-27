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
        self.addAsyncCleanup(self.tx.rollback)
        for name in ('put__record_crypto_expense', 'put__record_portfolio_income', 'put__swap_crypto_investment_asset'):
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

    async def test_funded_manual_swap_rejects_without_changing_position(self):
        import asyncpg
        funded = await self.db.fetchrow("""select id,quantity,metadata from budgeting.portfolio_positions
            where owner_user_id=$1 and status='open' and quantity>1
            and coalesce(metadata->'funding_units','{}')<>'{}'::jsonb limit 1""", UID)
        self.assertIsNotNone(funded, 'Imported history must retain open financing')
        asset = await self.db.fetchval("select id from budgeting.crypto_assets where id<>$1 order by id limit 1", int(funded['metadata']['crypto_asset_id']))
        with self.assertRaisesRegex(asyncpg.RaiseError, 'заёмным финансированием'):
            await self.client.post('/api/v1/crypto/swap-investment-asset', json=dict(
                position_id=funded['id'], from_amount='0.1', to_crypto_asset_id=asset,
                to_amount='1', operated_at='2026-09-08'))
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
