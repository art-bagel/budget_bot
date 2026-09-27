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
        await self.db.execute((ROOT / 'infra/db/Scripts/budgeting/tb/crypto_source_revisions.sql').read_text())
        for name in ('capture__crypto_mutation', 'get__crypto_correction_fields', 'get__crypto_correction_state', 'get__crypto_correction_history', 'put__correct_crypto_source', 'put__record_crypto_expense', 'put__record_portfolio_income', 'put__swap_crypto_investment_asset', 'put__manual_crypto_movement', 'put__crypto_source_event', 'put__crypto_funding_components', 'put__partial_close_crypto_protocol_position', 'get__portfolio_positions', 'get__portfolio_position', 'get__crypto_protocol_positions', 'set__update_crypto_protocol_position', 'put__lending_liquidate', 'get__crypto_protocol_history'):
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
        self.reports_patcher = patch.object(portfolio.reports, "call_function", side_effect=call)
        self.reports_patcher.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.patcher.stop()
        self.reports_patcher.stop()

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

    async def test_manual_new_lending_borrow_swap_partial_repay_and_retry(self):
        from uuid import uuid4
        import asyncpg
        from backend.app.dependencies import CurrentUser, get_current_user
        from check_user_history import fingerprint
        uid = 900000000000 + uuid4().int % 1000000000
        await self.db.execute("insert into budgeting.users(id,base_currency_code) values($1,'RUB')", uid)
        account = await self.db.fetchval("""insert into budgeting.bank_accounts
            (owner_type,owner_user_id,name,account_kind,investment_asset_type)
            values('user',$1,'Manual lending test','investment','crypto') returning id""", uid)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)
        asset = self.position['asset_id']
        debt_asset = await self.db.fetchval('select id from budgeting.crypto_assets where id<>$1 order by id limit 1', asset)
        collateral = await self.db.fetchval("select budgeting.put__crypto_receive_reward($1,$2,$3,10,NULL,'2026-09-08')", uid, account, asset)
        await self.db.execute('''insert into budgeting.portfolio_events
            (position_id,event_type,event_at,quantity,metadata,created_by_user_id)
            values($1,'top_up','2026-09-08',0,'{"entry_value_in_base":1000}',$2)''', collateral['position_id'], uid)
        created = await self.client.post('/api/v1/crypto/protocol-positions', json=dict(
            investment_account_id=account, protocol_name='Test lending', position_type='lending',
            asset_symbol='JETTON', crypto_asset_id=asset, quantity='10', source_position_id=collateral['position_id'], deposited_at='2026-09-08'))
        self.assertEqual(created.status_code, 200, created.text)
        loan = created.json()['id']
        path = f'/api/v1/crypto/protocol-positions/{loan}'
        borrow = dict(request_id=str(uuid4()), debt_qty='10.123456789012345678',
                      borrowed_crypto_asset_id=debt_asset, operated_at='2026-09-08', value_in_base=999999)
        response = await self.client.post(path+'/take-debt', json=borrow)
        self.assertEqual(response.status_code, 200, response.text)
        meta = await self.db.fetchval('select metadata from budgeting.crypto_protocol_positions where id=$1', loan)
        source = meta['borrowed_position_id']
        self.assertEqual(meta['funding_policy'], 'components')
        q = await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1', source)
        self.assertEqual(q, D(borrow['debt_qty']))
        summary = await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', source)
        self.assertEqual(D(str(summary['remaining_cost_basis'])), 0)
        self.assertEqual(await self.db.fetchval("select (metadata->'funding_units'->>$2)::numeric from budgeting.portfolio_positions where id=$1", source, str(loan)), q)
        swapped = await self.client.post('/api/v1/crypto/swap-investment-asset', json=dict(
            request_id=str(uuid4()), position_id=source, from_amount=borrow['debt_qty'],
            to_crypto_asset_id=asset, to_amount='100', operated_at='2026-09-08'))
        self.assertEqual(swapped.status_code, 200, swapped.text)
        target = await self.db.fetchval("select id from budgeting.portfolio_positions where investment_account_id=$1 and status='open' and metadata->>'crypto_asset_id'=$2", account, str(asset))
        # Purchased repayment coins: controlled fixture with known 1,000 RUB basis.
        purchased = await self.db.fetchval("select budgeting.put__crypto_receive_reward($1,$2,$3,5,NULL,'2026-09-08')", uid, account, debt_asset)
        source = purchased['position_id']
        await self.db.execute("""insert into budgeting.portfolio_events
            (position_id,event_type,event_at,quantity,metadata,created_by_user_id)
            values($1,'top_up','2026-09-08',0,'{"entry_value_in_base":1000}',$2)""", source, uid)
        repay = dict(request_id=str(uuid4()), source_position_id=source, repay_qty='5', operated_at='2026-09-08')
        before = await fingerprint(self.db)
        with self.assertRaises(asyncpg.RaiseError):
            await self.client.post(path+'/repay-debt', json={**repay, 'fee':dict(source_position_id=target,quantity='1000')})
        self.assertEqual(before, await fingerprint(self.db))
        paid = await self.client.post(path+'/repay-debt', json=repay)
        self.assertEqual(paid.status_code, 200, paid.text)
        summary = await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', target)
        self.assertEqual(D(str(summary['remaining_cost_basis'])), D('1000'))
        self.assertEqual(await self.db.fetchval("select (metadata->'funding_units'->>$2)::numeric from budgeting.portfolio_positions where id=$1", target, str(loan)), q-D(5))
        self.assertEqual(paid.json(), (await self.client.post(path+'/repay-debt', json=repay)).json())
        self.assertEqual(response.json(), (await self.client.post(path+'/take-debt', json=borrow)).json())
        before = await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'другими данными'):
            await self.client.post(path+'/repay-debt', json={**repay, 'repay_qty':'4'})
        self.assertEqual(before, await fingerprint(self.db))
        for qty in ('NaN','Infinity','0','-1','0.0000000000000000001'):
            bad = await self.client.post(path+'/take-debt', json={**borrow,'debt_qty':qty})
            self.assertEqual(bad.status_code, 422, bad.text)

        accrued_body = dict(request_id=str(uuid4()), external_id='manual-test-interest', quantity='1', operated_at='2026-09-08')
        accrued = await self.client.post(path+'/accrue-interest', json=accrued_body)
        self.assertEqual(accrued.status_code, 200, accrued.text)
        liquidated_body = dict(request_id=str(uuid4()), collateral_qty='2', debt_qty='1',
                               interest_qty='0.2', collateral_fee_qty='0.1', operated_at='2026-09-08')
        liquidated = await self.client.post(path+'/liquidate', json=liquidated_body)
        self.assertEqual(liquidated.status_code, 200, liquidated.text)
        summary = await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', target)
        self.assertEqual(D(str(summary['remaining_cost_basis'])), D('1152'))
        units = await self.db.fetchval("select (metadata->'funding_units'->>$2)::numeric from budgeting.portfolio_positions where id=$1", target, str(loan))
        self.assertEqual(units, q-D('5.8'))
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.crypto_protocol_positions where id=$1', loan), D(8))
        self.assertEqual(await self.db.fetchval("select (metadata->>'debt_interest_quantity')::numeric from budgeting.crypto_protocol_positions where id=$1", loan), D('0.8'))
        self.assertEqual(liquidated.json(), (await self.client.post(path+'/liquidate', json=liquidated_body)).json())
        self.assertEqual(accrued.json(), (await self.client.post(path+'/accrue-interest', json=accrued_body)).json())
        self.assertEqual(accrued.json(), (await self.client.post(path+'/accrue-interest', json={**accrued_body, 'request_id':str(uuid4())})).json())

        # Interest is an expense, only principal settles financing at asset holders.
        purchased = await self.db.fetchval("select budgeting.put__crypto_receive_reward($1,$2,$3,1.8,NULL,'2026-09-08')", uid, account, debt_asset)
        await self.db.execute('''insert into budgeting.portfolio_events
            (position_id,event_type,event_at,quantity,metadata,created_by_user_id)
            values($1,'top_up','2026-09-08',0,'{"entry_value_in_base":180}',$2)''', purchased['position_id'], uid)
        paid_interest = await self.client.post(path+'/repay-debt', json=dict(
            request_id=str(uuid4()), source_position_id=purchased['position_id'], repay_qty='1.8',
            interest_qty='0.8', operated_at='2026-09-08'))
        self.assertEqual(paid_interest.status_code, 200, paid_interest.text)
        summary = await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', target)
        self.assertEqual(D(str(summary['remaining_cost_basis'])), D('1252'))
        self.assertEqual(await self.db.fetchval("select (metadata->>'debt_interest_quantity')::numeric from budgeting.crypto_protocol_positions where id=$1", loan), D(0))
        self.assertEqual(await self.db.fetchval("select (metadata->>'funding_interest_cost')::numeric from budgeting.portfolio_events where position_id=$1 and metadata->>'target_kind'='lending_repay' order by id desc limit 1", purchased['position_id']), D(80))
        before = await fingerprint(self.db)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=UID)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'Нет доступа'):
            await self.client.post(path+'/take-debt', json=borrow)
        self.assertEqual(before, await fingerprint(self.db))

    async def fresh_crypto(self):
        from uuid import uuid4
        from backend.app.dependencies import CurrentUser, get_current_user
        uid = 900000000000 + uuid4().int % 1000000000
        await self.db.execute("insert into budgeting.users(id,base_currency_code) values($1,'RUB')", uid)
        account = await self.db.fetchval("""insert into budgeting.bank_accounts
            (owner_type,owner_user_id,name,account_kind,investment_asset_type)
            values('user',$1,'Manual lifecycle','investment','crypto') returning id""", uid)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)
        asset = self.position['asset_id']
        other = await self.db.fetchval('select id from budgeting.crypto_assets where id<>$1 order by id limit 1', asset)
        async def seed(coin, qty, basis):
            result = await self.db.fetchval("select budgeting.put__crypto_receive_reward($1,$2,$3,$4,NULL,'2026-09-08')", uid, account, coin, D(qty))
            await self.db.execute('''insert into budgeting.portfolio_events
                (position_id,event_type,event_at,quantity,metadata,created_by_user_id)
                values($1,'top_up','2026-09-08',0,jsonb_build_object('entry_value_in_base',$2::numeric),$3)''', result['position_id'], D(basis), uid)
            return result['position_id']
        return uid, account, asset, other, seed

    async def test_create_initial_loan_stake_funded_coins_and_return(self):
        from uuid import uuid4
        from check_user_history import fingerprint
        import asyncpg
        uid, account, asset, other, seed = await self.fresh_crypto()
        source = await seed(asset, '20', '2000')
        payload = dict(request_id=str(uuid4()),investment_account_id=account,protocol_name='Manual loan',
            position_type='lending',asset_symbol='JETTON',source_position_id=source,quantity='10',
            deposited_at='2026-09-08',borrowed_crypto_asset_id=other,borrowed_quantity='10.123456789012345678')
        url='/api/v1/crypto/protocol-positions'
        before=await fingerprint(self.db)
        with self.assertRaises(asyncpg.RaiseError):
            await self.client.post(url,json={**payload,'fee':dict(source_position_id=source,quantity='999')})
        self.assertEqual(before,await fingerprint(self.db))
        payload['fee']=dict(source_position_id=source,quantity='0.1')
        created=await self.client.post(url,json=payload)
        self.assertEqual(created.status_code,200,created.text)
        loan=created.json()['id']
        self.assertEqual(await self.db.fetchval("select count(*) from budgeting.portfolio_events where event_type='fee' and metadata->>'protocol_position_id'=$1",str(loan)),1)
        self.assertEqual(created.json(),(await self.client.post(url,json=payload)).json())
        meta=await self.db.fetchval('select metadata from budgeting.crypto_protocol_positions where id=$1',loan)
        borrowed=meta['borrowed_position_id']
        self.assertEqual(meta['funding_policy'],'components')
        qty=D(payload['borrowed_quantity'])
        self.assertEqual(await self.db.fetchval("select (metadata->'funding_units'->>$2)::numeric from budgeting.portfolio_positions where id=$1",borrowed,str(loan)),qty)
        staking=dict(request_id=str(uuid4()),investment_account_id=account,protocol_name='Manual stake',
            position_type='staking',asset_symbol='COIN',source_position_id=borrowed,quantity=str(qty),deposited_at='2026-09-08')
        opened=await self.client.post(url,json=staking)
        self.assertEqual(opened.status_code,200,opened.text)
        stake=opened.json()['id']
        path=f'{url}/{stake}'
        withdrawn=dict(request_id=str(uuid4()),principal_qty='1.123456789012345678',returned_at='2026-09-08')
        returned=await self.client.post(path+'/partial-close',json=withdrawn)
        self.assertEqual(returned.status_code,200,returned.text)
        remaining=await self.db.fetchval("select (metadata->'funding_units0'->>$2)::numeric from budgeting.crypto_protocol_positions where id=$1",stake,str(loan))
        self.assertEqual(remaining,D(9))
        accrued_body=dict(request_id=str(uuid4()),quantity='2',operated_at='2026-09-08')
        accrued=await self.client.post(path+'/yield',json=accrued_body)
        self.assertEqual(accrued.status_code,200,accrued.text)
        self.assertEqual(accrued.json(),(await self.client.post(path+'/yield',json=accrued_body)).json())
        self.assertEqual(await self.db.fetchval('select current_quantity from budgeting.crypto_protocol_positions where id=$1',stake),D(11))
        rewards=await self.client.post(path+'/partial-close',json=dict(request_id=str(uuid4()),rewards_qty='2',returned_at='2026-09-08'))
        self.assertEqual(rewards.status_code,200,rewards.text)
        self.assertEqual(await self.db.fetchval("select (metadata->'funding_units0'->>$2)::numeric from budgeting.crypto_protocol_positions where id=$1",stake,str(loan)),D(9))
        close=dict(request_id=str(uuid4()),return_quantity='9',withdrawn_at='2026-09-08')
        closed=await self.client.post(path+'/close',json=close)
        self.assertEqual(closed.status_code,200,closed.text)
        self.assertEqual(closed.json(),(await self.client.post(path+'/close',json=close)).json())
        self.assertEqual(returned.json(),(await self.client.post(path+'/partial-close',json=withdrawn)).json())
        self.assertEqual(opened.json(),(await self.client.post(url,json=staking)).json())
        self.assertEqual(await self.db.fetchval("select sum((metadata->'funding_units'->>$2)::numeric) from budgeting.portfolio_positions where investment_account_id=$1 and status='open'",account,str(loan)),qty)
        # Collateral top-up/withdrawals carry historical cost; debt remains independent.
        topup=dict(request_id=str(uuid4()),source_position_id=source,quantity='5',operated_at='2026-09-08')
        topped=await self.client.post(f'{url}/{loan}/top-up',json=topup)
        self.assertEqual(topped.status_code,200,topped.text)
        self.assertEqual(D(str(topped.json()['cost_basis_in_base'])),D(1500))
        out=await self.client.post(f'{url}/{loan}/partial-close',json=dict(request_id=str(uuid4()),principal_qty='3',returned_at='2026-09-08'))
        self.assertEqual(out.status_code,200,out.text)
        self.assertEqual(D(str(out.json()['cost_basis_in_base'])),D(1200))
        self.assertEqual(topped.json(),(await self.client.post(f'{url}/{loan}/top-up',json=topup)).json())

    async def test_lp_close_reallocates_20000_and_rewards_do_not_consume_principal(self):
        from uuid import uuid4
        from check_user_history import fingerprint
        import asyncpg
        uid, account, asset, other, seed=await self.fresh_crypto()
        a=await seed(asset,'100','10000')
        b=await seed(other,'1000','10000')
        url='/api/v1/crypto/protocol-positions'
        data=dict(request_id=str(uuid4()),investment_account_id=account,protocol_name='Manual LP',position_type='liquidity_pool',
            asset_symbol='JETTON',source_position_id=a,quantity='100',secondary_source_position_id=b,secondary_quantity='1000',deposited_at='2026-09-08')
        created=await self.client.post(url,json=data)
        self.assertEqual(created.status_code,200,created.text)
        lp=created.json()['id']
        path=f'{url}/{lp}'
        # Rewards are outside LP principal, can exceed the deposited token quantity.
        rewards=dict(request_id=str(uuid4()),rewards_qty='101.123456789012345678',secondary_rewards_qty='2',returned_at='2026-09-08')
        earned=await self.client.post(path+'/partial-close',json=rewards)
        self.assertEqual(earned.status_code,200,earned.text)
        self.assertEqual(D(str(earned.json()['cost_basis_in_base'])),D(20000))
        before=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'Частичный выход LP'):
            await self.client.post(path+'/partial-close',json=dict(principal_qty='10',secondary_principal_qty='10',returned_at='2026-09-08'))
        self.assertEqual(before,await fingerprint(self.db))
        close=dict(request_id=str(uuid4()),return_quantity='10',secondary_return_quantity='2000',withdrawn_at='2026-09-08',return_value_in_base=999,secondary_return_value_in_base=999)
        closed=await self.client.post(path+'/close',json=close)
        self.assertEqual(closed.status_code,200,closed.text)
        for coin,cost in ((asset,1000),(other,19000)):
            pid=await self.db.fetchval("select id from budgeting.portfolio_positions where investment_account_id=$1 and status='open' and metadata->>'crypto_asset_id'=$2",account,str(coin))
            summary=await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)',pid)
            self.assertEqual(D(str(summary['remaining_cost_basis'])),D(cost))
        self.assertEqual(closed.json(),(await self.client.post(path+'/close',json=close)).json())
        self.assertEqual(earned.json(),(await self.client.post(path+'/partial-close',json=rewards)).json())

    async def test_funded_lp_claim_close_and_unsafe_adjustment_rejected(self):
        from uuid import uuid4
        from check_user_history import fingerprint
        import asyncpg
        uid,account,asset,other,seed=await self.fresh_crypto()
        collateral=await seed(asset,'20','2000')
        base='/api/v1/crypto/protocol-positions'
        response=await self.client.post(base,json=dict(request_id=str(uuid4()),investment_account_id=account,
            protocol_name='Loan for LP',position_type='lending',asset_symbol='JETTON',quantity='10',
            source_position_id=collateral,borrowed_crypto_asset_id=other,borrowed_quantity='10',deposited_at='2026-09-08'))
        self.assertEqual(response.status_code,200,response.text)
        loan=response.json()['id']
        borrowed=await self.db.fetchval("select (metadata->>'borrowed_position_id')::bigint from budgeting.crypto_protocol_positions where id=$1",loan)
        response=await self.client.post(base,json=dict(request_id=str(uuid4()),investment_account_id=account,
            protocol_name='Funded LP',position_type='liquidity_pool',asset_symbol='COIN',quantity='10',
            source_position_id=borrowed,secondary_source_position_id=collateral,secondary_quantity='10',deposited_at='2026-09-08'))
        self.assertEqual(response.status_code,200,response.text)
        lp=response.json()['id']
        before=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'через операции'):
            await self.client.patch(f'{base}/{lp}',json=dict(metadata={'funding_units0':{}}))
        self.assertEqual(before,await fingerprint(self.db))
        for qty in ('NaN','Infinity','0.0000000000000000001'):
            response=await self.client.post(f'{base}/{lp}/top-up',json=dict(source_position_id=borrowed,quantity=qty))
            self.assertEqual(response.status_code,422,response.text)
        claimed=await self.client.post(f'{base}/{lp}/partial-close',json=dict(request_id=str(uuid4()),rewards_qty='0.5',secondary_rewards_qty='1',returned_at='2026-09-08'))
        self.assertEqual(claimed.status_code,200,claimed.text)
        self.assertEqual(await self.db.fetchval("select (metadata->'funding_units0'->>$2)::numeric from budgeting.crypto_protocol_positions where id=$1",lp,str(loan)),D(10))
        closed=await self.client.post(f'{base}/{lp}/close',json=dict(request_id=str(uuid4()),return_quantity='5',secondary_return_quantity='15',withdrawn_at='2026-09-08'))
        self.assertEqual(closed.status_code,200,closed.text)
        holders=await self.db.fetch("select metadata->>'crypto_asset_id' asset, (metadata->'funding_units'->>$2)::numeric units from budgeting.portfolio_positions where investment_account_id=$1 and status='open'",account,str(loan))
        self.assertEqual({r['asset']:r['units'] for r in holders if r['asset']},{str(asset):D(5),str(other):D(5)})
        self.assertEqual(await self.db.fetchval("select metadata->'funding_units0' from budgeting.crypto_protocol_positions where id=$1",lp),{})

    async def test_liquidation_of_other_collateral_in_same_account(self):
        from uuid import uuid4
        from check_user_history import fingerprint
        import asyncpg
        uid,account,asset,other,seed=await self.fresh_crypto()
        primary=await seed(asset,'10','1000')
        third=await self.db.fetchval('select id from budgeting.crypto_assets where id<>$1 and id<>$2 order by id limit 1',asset,other)
        secondary=await seed(third,'20','2000')
        base='/api/v1/crypto/protocol-positions'
        debt=await self.client.post(base,json=dict(investment_account_id=account,protocol_name='Shared',position_type='lending',
            asset_symbol='JETTON',quantity='10',source_position_id=primary,borrowed_crypto_asset_id=other,borrowed_quantity='10',deposited_at='2026-09-08'))
        self.assertEqual(debt.status_code,200,debt.text)
        loan=debt.json()['id']
        collateral=await self.client.post(base,json=dict(investment_account_id=account,protocol_name='Shared',position_type='lending',
            asset_symbol='COIN',quantity='20',source_position_id=secondary,deposited_at='2026-09-08'))
        self.assertEqual(collateral.status_code,200,collateral.text)
        cid=collateral.json()['id']
        grouping=dict(request_id=str(uuid4()),other_position_id=cid,operated_at='2026-09-08')
        grouped=await self.client.post(f'{base}/{loan}/group-with',json=grouping)
        self.assertEqual(grouped.status_code,200,grouped.text)
        self.assertEqual(grouped.json(),(await self.client.post(f'{base}/{loan}/group-with',json=grouping)).json())
        key=grouped.json()['lending_account_key']
        await self.db.execute("update budgeting.crypto_protocol_positions set metadata=metadata||jsonb_build_object('lending_account_key',$2::text) where id=$1",cid,'lp/user')
        body=dict(request_id=str(uuid4()),collateral_position_id=cid,collateral_qty='2',debt_qty='1',collateral_fee_qty='0',interest_qty='0',operated_at='2026-09-08')
        before=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'одному подтверждённому'):
            await self.client.post(f'{base}/{loan}/liquidate',json=body)
        self.assertEqual(before,await fingerprint(self.db))
        await self.db.execute("update budgeting.crypto_protocol_positions set metadata=metadata||jsonb_build_object('lending_account_key',$2::text) where id=$1",cid,key)
        done=await self.client.post(f'{base}/{loan}/liquidate',json=body)
        self.assertEqual(done.status_code,200,done.text)
        self.assertEqual(done.json()['collateral_asset_id'],third)
        self.assertEqual(done.json()['collateral_position_id'],cid)
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.crypto_protocol_positions where id=$1',loan),D(10))
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.crypto_protocol_positions where id=$1',cid),D(18))
        self.assertEqual(await self.db.fetchval('select cost_basis_in_base from budgeting.crypto_protocol_positions where id=$1',cid),D(1800))
        self.assertEqual(await self.db.fetchval("select (metadata->>'borrowed_quantity')::numeric from budgeting.crypto_protocol_positions where id=$1",loan),D(9))
        self.assertEqual(done.json(),(await self.client.post(f'{base}/{loan}/liquidate',json=body)).json())
        history=await self.db.fetchval('select budgeting.get__crypto_protocol_history($1,$2)',uid,cid)
        self.assertTrue(any(r['kind']=='collateral_liquidation' for r in history['entries']))
        self.assertTrue(any(r['kind']=='liquidation_fee' and r['quantity']==0 for r in history['entries']))


    async def test_reward_and_standalone_fee_retry(self):
        from uuid import uuid4
        uid,account,asset,other,seed=await self.fresh_crypto()
        pid=await seed(asset,'10','1000')
        reward=dict(request_id=str(uuid4()),amount=0,currency_code='RUB',quantity='1.123456789012345678',destination='position',income_kind='reward',received_at='2026-09-08')
        url=f'/api/v1/portfolio/positions/{pid}/income'
        got=await self.client.post(url,json=reward)
        self.assertEqual(got.status_code,200,got.text)
        fee=dict(request_id=str(uuid4()),quantity='0.123456789012345678',operated_at='2026-09-08')
        feeurl=f'/api/v1/crypto/asset-positions/{pid}/pay-fee'
        paid=await self.client.post(feeurl,json=fee)
        self.assertEqual(paid.status_code,200,paid.text)
        self.assertEqual(got.json(),(await self.client.post(url,json=reward)).json())
        self.assertEqual(paid.json(),(await self.client.post(feeurl,json=fee)).json())
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1',pid),D(11))

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

    async def test_revision_preview_apply_retry_and_conflicts(self):
        from uuid import uuid4
        import asyncpg
        from check_user_history import fingerprint
        uid,account,asset,other,seed=await self.fresh_crypto()
        pid=await seed(asset,'100','10000')
        swapped=await self.client.post('/api/v1/crypto/swap-investment-asset',json=dict(
            request_id=str(uuid4()),position_id=pid,from_amount='10',to_crypto_asset_id=other,
            to_amount='100',operated_at='2026-09-08'))
        self.assertEqual(swapped.status_code,200,swapped.text)
        sid=await self.db.fetchval('select max(id) from budgeting.crypto_source_events where anchor_account_id=$1',account)
        target=await self.db.fetchval("select id from budgeting.portfolio_positions where investment_account_id=$1 and metadata->>'crypto_asset_id'=$2",account,str(other))
        loan=await self.client.post('/api/v1/crypto/protocol-positions',json=dict(
            request_id=str(uuid4()),investment_account_id=account,protocol_name='Revision collateral',
            position_type='lending',crypto_asset_id=other,asset_symbol='TEST',quantity='50',
            source_position_id=target,deposited_at='2026-09-08',borrowed_crypto_asset_id=asset,borrowed_quantity='5'))
        self.assertEqual(loan.status_code,200,loan.text)
        # Correct the early swap: same 1,000 RUB carried, twice the received coins.
        request=uuid4()
        changes=[dict(command_index=0,field='to_amount',value='200')]
        before=await fingerprint(self.db)
        async def correct(apply=False,token=None,revision=1,request_id=request):
            return await self.db.fetchval('select budgeting.put__correct_crypto_source($1,$2,$3,$4,$5,$6,$7,$8)',
                uid,sid,revision,request_id,changes,'Уточнено количество обмена',apply,token)
        preview=await correct()
        self.assertFalse(preview['applied'])
        self.assertEqual(before,await fingerprint(self.db))
        self.assertEqual(preview['replayed_sources'],2)
        result=await correct(True,preview['preview_token'])
        self.assertTrue(result['applied'])
        self.assertEqual(await self.db.fetchval('select quantity from budgeting.portfolio_positions where id=$1',target),D(150))
        self.assertEqual(await self.db.fetchval('select cost_basis_in_base from budgeting.crypto_protocol_positions where id=$1',loan.json()['id']),D(250))
        self.assertEqual(result,await correct(True,preview['preview_token']))
        self.assertEqual(await self.db.fetchval('select count(*) from budgeting.crypto_source_revisions where source_event_id=$1',sid),1)
        # Another edit of an already corrected source, with original identities.
        changes[0]['value']='300'
        preview2=await correct(revision=2,request_id=uuid4())
        self.assertEqual(preview2['revision'],3)
        reward=await self.client.post(f'/api/v1/portfolio/positions/{target}/income',json=dict(
            request_id=str(uuid4()),amount=0,currency_code='RUB',quantity='1.123456789012345678',
            income_kind='reward',destination='position',received_at='2026-09-08'))
        self.assertEqual(reward.status_code,200,reward.text)
        stable=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'после просмотра'):
            async with self.db.transaction():
                await correct(True,preview2['preview_token'],revision=2,request_id=uuid4())
        self.assertEqual(stable,await fingerprint(self.db))
        changes[0]['value']='1'
        with self.assertRaises(asyncpg.RaiseError):
            async with self.db.transaction():
                await correct(revision=2,request_id=uuid4())
        self.assertEqual(stable,await fingerprint(self.db))
        changes[0]['value']='300'
        with self.assertRaisesRegex(asyncpg.RaiseError,'Нет доступа'):
            async with self.db.transaction():
                await self.db.fetchval('select budgeting.put__correct_crypto_source($1,$2,2,$3,$4,$5)',
                    UID,sid,uuid4(),changes,'Другой владелец')
        self.assertEqual(stable,await fingerprint(self.db))
        # Nonjournal change on a touched position must not be overwritten.
        await self.db.execute("update budgeting.portfolio_positions set comment='external edit' where id=$1",target)
        unchanged=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'вне журнала'):
            async with self.db.transaction():
                await correct(revision=2,request_id=uuid4())
        self.assertEqual(unchanged,await fingerprint(self.db))

    async def test_bank_purchase_revision_lp_sale_and_external_expense_conflict(self):
        from uuid import uuid4
        import asyncpg
        from check_user_history import fingerprint
        uid,account,asset,other,seed=await self.fresh_crypto()
        context=await self.db.fetchval("select budgeting.put__register_user_context($1,'RUB')",uid)
        bank=context['bank_account_id']
        # Test-only initial cash, before the corrected chain.
        await self.db.execute("insert into budgeting.current_bank_balances(bank_account_id,currency_code,amount,historical_cost_in_base) values($1,'RUB',20000,20000)",bank)
        otherpid=await seed(other,'1000','10000')
        purchase=dict(request_id=str(uuid4()),bank_account_id=bank,from_currency_code='RUB',from_amount='10000',
                      to_crypto_asset_id=asset,to_amount='100',operated_at='2026-09-08')
        bought=await self.client.post('/api/v1/operations/exchange',json=purchase)
        self.assertEqual(bought.status_code,200,bought.text)
        self.assertEqual(bought.json(),(await self.client.post('/api/v1/operations/exchange',json=purchase)).json())
        sid=await self.db.fetchval('select max(id) from budgeting.crypto_source_events where anchor_account_id=$1',bank)
        move=dict(request_id=str(uuid4()),bank_account_id=bank,investment_account_id=account,crypto_asset_id=asset,amount='100',operated_at='2026-09-08')
        moved=await self.client.post('/api/v1/crypto/transfer-to-investment',json=move)
        self.assertEqual(moved.status_code,200,moved.text)
        self.assertEqual(moved.json(),(await self.client.post('/api/v1/crypto/transfer-to-investment',json=move)).json())
        pid=moved.json()['position_id']
        lp=await self.client.post('/api/v1/crypto/protocol-positions',json=dict(
            request_id=str(uuid4()),investment_account_id=account,protocol_name='Correction LP',position_type='liquidity_pool',
            source_position_id=pid,crypto_asset_id=asset,asset_symbol='PAIR',quantity='50',
            secondary_source_position_id=otherpid,secondary_quantity='500',deposited_at='2026-09-08'))
        self.assertEqual(lp.status_code,200,lp.text)
        body=dict(request_id=str(uuid4()),expected_revision=1,reason='Исправлена сумма банковской покупки',
                  changes=[dict(command_index=0,field='fiat_amount',value='12000')])
        before=await fingerprint(self.db)
        preview=await self.client.post(f'/api/v1/crypto/source-events/{sid}/correct',json=body)
        self.assertEqual(preview.status_code,200,preview.text)
        self.assertEqual(before,await fingerprint(self.db))
        applied=await self.client.post(f'/api/v1/crypto/source-events/{sid}/correct',json={**body,'apply':True,'preview_token':preview.json()['preview_token']})
        self.assertEqual(applied.status_code,200,applied.text)
        self.assertEqual(await self.db.fetchval("select amount from budgeting.current_bank_balances where bank_account_id=$1 and currency_code='RUB'",bank),D(8000))
        self.assertEqual(await self.db.fetchval('select cost_basis_in_base from budgeting.crypto_protocol_positions where id=$1',lp.json()['id']),D(11000))
        summary=await self.db.fetchval('select budgeting.get__crypto_position_entry_summary($1)',pid)
        self.assertEqual(D(str(summary['remaining_cost_basis'])),D(6000))
        # Manual history shows the corrected version and immutable original input.
        history=await self.client.get(f'/api/v1/crypto/correction-history?anchor_account_id={account}')
        self.assertEqual(history.status_code,200,history.text)
        changed=next(r for r in history.json() if r['id']==sid)
        self.assertEqual(changed['previous_versions'][0]['commands'][0]['payload']['fiat_amount'],'10000')
        # Withdraw/sell keeps actual proceeds in the bank, with WAC basis.
        withdrawal=dict(request_id=str(uuid4()),position_id=pid,bank_account_id=bank,amount='10',operated_at='2026-09-08')
        out=await self.client.post('/api/v1/crypto/transfer-from-investment',json=withdrawal)
        self.assertEqual(out.status_code,200,out.text)
        self.assertEqual(out.json(),(await self.client.post('/api/v1/crypto/transfer-from-investment',json=withdrawal)).json())
        sale=dict(request_id=str(uuid4()),bank_account_id=bank,from_crypto_asset_id=asset,from_amount='10',
                  to_currency_code='RUB',to_amount='2000',operated_at='2026-09-08')
        sold=await self.client.post('/api/v1/operations/exchange',json=sale)
        self.assertEqual(sold.status_code,200,sold.text)
        self.assertEqual(D(str(sold.json()['realized_fx_result_in_base'])),D(800))
        self.assertEqual(sold.json(),(await self.client.post('/api/v1/operations/exchange',json=sale)).json())
        # Ordinary categorised spending is retained; conflicting bank rewind fails.
        expense=await self.client.post('/api/v1/operations/expense',json=dict(bank_account_id=bank,
            category_id=await self.db.fetchval("insert into budgeting.categories(owner_type,owner_user_id,name,kind) values('user',$1,'Test regular','regular') returning id",uid),amount=100,currency_code='RUB',operated_at='2026-09-09'))
        self.assertEqual(expense.status_code,200,expense.text)
        before=await fingerprint(self.db)
        with self.assertRaisesRegex(asyncpg.RaiseError,'вне журнала'):
            await self.client.post(f'/api/v1/crypto/source-events/{sid}/correct',json={**body,'request_id':str(uuid4()),'expected_revision':2,
                'changes':[dict(command_index=0,field='fiat_amount',value='13000')]})
        self.assertEqual(before,await fingerprint(self.db))


if __name__ == '__main__':
    unittest.main()
