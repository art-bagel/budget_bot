"""Source journal integration checks against an isolated real PostgreSQL fixture.

Run run_checks.py first, then load crypto_source_events.sql and its three
functions. Usage: python -m backend.tests.test_crypto_source_events_api SOCKET PORT
Authentication and surrounding owner helpers use the disposable test fixture.
"""
import asyncio
import json
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

    checks = []

    def check(name, condition):
        checks.append({'name': name, 'passed': bool(condition)})
        assert condition, name

    def envelope(source_id, commands, order=0, time='2025-01-06T12:00:00.123456+03:00'):
        return dict(anchor_account_id=1, source_namespace='audit', source_id=source_id,
                    occurred_at=time, order_in_timestamp=order, accounting_date='2025-01-06',
                    commands=commands, evidence={'document': 'synthetic fixture'})

    def fee(qty='1', position=1):
        return dict(kind='fee', payload=dict(source_position_id=position, quantity=qty))

    try:
        pool = await crypto.ledger._get_pool()

        async def sql(query, *args):
            async with pool.acquire() as db:
                return await db.fetchval(query, *args)

        async def snapshot():
            return await sql('''SELECT jsonb_build_object(
                'positions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM budgeting.portfolio_positions p),
                'protocols',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM budgeting.crypto_protocol_positions p),
                'events',(SELECT count(*) FROM budgeting.portfolio_events),
                'operations',(SELECT count(*) FROM budgeting.operations),
                'sources',(SELECT count(*) FROM budgeting.crypto_source_events),
                'links',(SELECT count(*) FROM budgeting.crypto_source_event_links))''')

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            async def post(body, status=200):
                response = await client.post('/api/v1/crypto/source-events', json=body)
                assert response.status_code == status, response.text
                return response.json()

            swap = dict(kind='swap', payload=dict(position_id=1, from_amount='10',
                to_crypto_asset_id=2, to_amount='20', value_in_base='1500', valuation_source='audit fill'))
            first = envelope('swap-and-fee', [swap, fee('0.000000000000000001')])
            before = await sql('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=1')
            result = await post(first)
            saved = await snapshot()
            check('retry_identical_response_no_changes', await post(first) == result and await snapshot() == saved)
            check('equivalent_timezone_is_same_event', await post({**first, 'occurred_at': '2025-01-06T09:00:00.123456Z'}) == result)
            check('one_source_links_multiple_legs',
                  len(result['results']) == 2 and len(result['links']) == 4
                  and {x['command_index'] for x in result['links']} == {0, 1})
            exact = await sql('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=1')
            from decimal import Decimal
            check('exact_quantity_through_envelope', Decimal(exact) == Decimal(before)-Decimal('10.000000000000000001'))
            date = await sql('SELECT min(event_at)::text FROM budgeting.portfolio_events WHERE id IN (SELECT ledger_id FROM budgeting.crypto_source_event_links WHERE ledger_table=\'portfolio_events\')')
            check('accounting_date_applied_to_all_legs', date == '2025-01-06')
            for name, change in [('changed_quantity', {'commands': [fee('2')]}),
                                 ('changed_evidence', {'evidence': {'document': 'other'}}),
                                 ('changed_timestamp', {'occurred_at': '2025-01-06T12:01:00+03:00'})]:
                await post({**first, **change}, 400)
                check(name+'_rejected_without_changes', await snapshot() == saved)
            await post(envelope('out-of-order', [fee()], time='2025-01-06T12:00:00+03:00'), 400)
            await post(envelope('order-collision', [fee()]), 400)
            check('out_of_order_and_collision_no_changes', await snapshot() == saved)
            second = envelope('same-time-next', [fee()], order=1)
            concurrent = await asyncio.gather(post(second), post(second))
            check('concurrent_retry_once', concurrent[0] == concurrent[1] and await sql('SELECT count(*) FROM budgeting.crypto_source_events') == 2)
            saved = await snapshot()
            await post(envelope('rollback', [fee(), fee('1000000')], order=2), 400)
            check('second_leg_failure_rolls_back_envelope_and_first_leg', await snapshot() == saved)
            retry_failed = await post(envelope('rollback', [fee()], order=2))
            check('failed_source_can_be_retried', retry_failed['source_event_id'] > 0)
            saved = await snapshot()
            await post(envelope('snapshot', [dict(kind='create_protocol', payload=dict(
                investment_account_id=1, protocol_name='Invalid snapshot', position_type='lending',
                asset_symbol='TON', source_position_id=1, quantity='1', current_quantity='100'))], order=3), 400)
            check('final_balance_instead_of_operations_rejected', await snapshot() == saved)
            for kind, payload in [('fee', {'source_position_id': 1, 'quantity': '1', 'user_id': 2}),
                                  ('fee', {'source_position_id': 1, 'quantity': '1', 'operated_at': '2020-01-01'})]:
                await post(envelope('override', [dict(kind=kind,payload=payload)], order=3), 400)
            check('actor_and_date_override_rejected', await snapshot() == saved)
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=2)
            await post(first, 400)
            denied = await client.get('/api/v1/crypto/source-events', params={'anchor_account_id': 1})
            check('unauthorized_retry_and_read_denied', denied.status_code == 400)
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
            page = await client.get('/api/v1/crypto/source-events', params={'anchor_account_id': 1, 'limit': 1, 'offset': 1})
            check('paginated_ordered_history', page.status_code == 200 and len(page.json()) == 1 and page.json()[0]['source_id'] == 'same-time-next')
            for field, value in [('occurred_at', '2025-01-06T12:00:00'), ('source_id', ' '), ('order_in_timestamp', -1), ('commands', [])]:
                await post({**first, field: value}, 422)
            check('envelope_validation', True)
            # Ordinary existing routes must not accidentally inherit a pooled connection's context.
            links_before = await sql('SELECT count(*) FROM budgeting.crypto_source_event_links')
            response = await client.post('/api/v1/crypto/asset-positions/1/pay-fee', json={'quantity': '1'})
            check('journal_context_does_not_leak', response.status_code == 200 and await sql('SELECT count(*) FROM budgeting.crypto_source_event_links') == links_before)
            # Existing protocol from SQL runner is version 2; all generated journals must link too.
            protocol = await sql('SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=1')
            accrual = envelope('accrue', [dict(kind='accrue', payload=dict(position_id=1,
                collateral_qty='0.01', interest_qty='0.1', interest_value_in_base=None,
                collateral_before=str(protocol['quantity']), debt_before=str(protocol['metadata']['borrowed_quantity'])))], order=3)
            accrued = await post(accrual)
            check('accrual_and_liability_links', {x['ledger_table'] for x in accrued['links']} == {'crypto_protocol_accrual_events','crypto_liability_events'})
            check('accrual_repeat_through_source', await post(accrual) == accrued)
            # Create, top-up, partial return, borrow, repay and close through the same dispatcher.
            created = await post(envelope('create', [dict(kind='create_protocol', payload=dict(
                investment_account_id=1, protocol_name='Source audit', position_type='lending',
                asset_symbol='TON', quantity='10', source_position_id=1))], order=4))
            pid = created['results'][0]['id']
            commands = [dict(kind='top_up_protocol', payload=dict(position_id=pid, source_position_id=1, quantity='1')),
                        dict(kind='partial_close_protocol', payload=dict(position_id=pid, principal_qty='1')),
                        dict(kind='borrow', payload=dict(position_id=pid, debt_qty='2', borrowed_crypto_asset_id=2)),
                        dict(kind='repay', payload=dict(position_id=pid, source_position_id=2, repay_qty='2')),
                        dict(kind='close_protocol', payload=dict(position_id=pid, return_quantity='10'))]
            lifecycle = await post(envelope('lifecycle', commands, order=5))
            check('five_command_protocol_lifecycle', len(lifecycle['results']) == 5 and lifecycle['results'][-1]['status'] == 'closed')
            saved = await snapshot()
            check('lifecycle_retry_preserves_state', await post(envelope('lifecycle', commands, order=5)) == lifecycle and await snapshot() == saved)
            remaining_kinds = [
                dict(kind='transfer', payload=dict(position_id=1, target_investment_account_id=2, amount='0.1')),
                dict(kind='accrue_interest', payload=dict(position_id=1, quantity='0.1', value_in_base=None)),
                dict(kind='liquidate', payload=dict(position_id=1, collateral_qty='1', debt_qty='1'))]
            remaining = await post(envelope('remaining-kinds', remaining_kinds, order=6))
            check('transfer_interest_liquidation_dispatch', len(remaining['results']) == 3 and
                  {x['ledger_table'] for x in remaining['links']} == {'operations','portfolio_events','crypto_liability_events'})
            saved = await snapshot()
            await post(envelope('bad-number', [fee('not-a-number')], order=7), 400)
            await post(envelope('too-precise', [fee('0.0000000000000000001')], order=7), 400)
            await post(envelope('float-number', [fee(0.1)], order=7), 422)
            check('invalid_or_inexact_numbers_no_changes', await snapshot() == saved)
            # Resource ownership is checked before any command can touch another scope.
            await sql("INSERT INTO budgeting.users VALUES(2) ON CONFLICT DO NOTHING")
            await sql("INSERT INTO budgeting.bank_accounts VALUES(33,'Other','user',2,NULL,'investment','crypto',true)")
            await post(envelope('cross-scope', [dict(kind='transfer', payload=dict(position_id=1, target_investment_account_id=33, amount='1'))], order=7), 400)
            check('cross_owner_command_rejected', await snapshot() == saved)
            # Rewards and external spending use the portfolio weighted-average ledger.
            await sql("INSERT INTO budgeting.bank_accounts VALUES(55,'Reward audit','user',1,NULL,'investment','crypto',true)")
            def reward(qty='10', account=55, asset=1):
                return dict(kind='reward', payload=dict(investment_account_id=account, crypto_asset_id=asset, quantity=qty))

            first_reward = envelope('first-free-reward', [reward()], order=7)
            reward_result = await post(first_reward)
            reward_position = reward_result['results'][0]['position_id']

            async def basis(position):
                return await sql('SELECT budgeting.get__crypto_position_entry_summary($1)', position)

            check('first_reward_creates_zero_cost_asset', (await basis(reward_position))['remaining_cost_basis'] == 0
                  and (await basis(reward_position))['quantity_now'] == 10
                  and len(reward_result['links']) == 1)
            saved = await snapshot()
            repeats = await asyncio.gather(post(first_reward), post(first_reward))
            check('reward_concurrent_repeat_no_duplicate', repeats[0] == repeats[1] == reward_result and await snapshot() == saved)
            # Synthetic purchased lot: ten units at total 1000, then ten free units.
            await sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":1000,\"basis_quality\":\"known\"}' WHERE position_id=$1", reward_position)
            await post(envelope('dilution-reward', [reward()], order=8))
            current = await basis(reward_position)
            check('reward_dilutes_average_without_adding_capital', current['quantity_now'] == 20 and current['remaining_cost_basis'] == 1000 and current['avg_cost_per_unit'] == 50)

            def expense(qty='5', position=reward_position):
                return dict(kind='expense', payload=dict(source_position_id=position, quantity=qty, comment='External purchase'))

            spend_envelope = envelope('external-expense', [expense()], order=9)
            spend = await post(spend_envelope)
            current = await basis(reward_position)
            check('expense_consumes_weighted_average', current['quantity_now'] == 15 and current['remaining_cost_basis'] == 750 and spend['results'][0]['consumed_cost_basis'] == 250)
            event = await sql("SELECT to_jsonb(e) FROM budgeting.portfolio_events e WHERE id=$1", spend['links'][0]['ledger_id'])
            check('expense_distinct_from_fee_or_own_transfer', event['event_type'] == 'transfer_out' and event['metadata']['action'] == 'external_expense' and event['metadata']['target_kind'] == 'expense' and event['metadata']['realized_in_base'] == -250 and event['event_at'] == '2025-01-06')
            saved = await snapshot()
            check('expense_repeat_once', await post(spend_envelope) == spend and await snapshot() == saved)
            await post(envelope('reward-spend-rollback', [reward(), expense('1000000')], order=10), 400)
            check('reward_and_failed_expense_roll_back_together', await snapshot() == saved)
            for command in [reward('NaN'), reward('0'), reward('-1'), reward('Infinity'), reward('0.0000000000000000001'), expense('NaN'), expense('0'), expense('-1')]:
                await post(envelope('invalid-reward-expense', [command], order=10), 400)
            await post(envelope('reward-price-override', [dict(kind='reward', payload={**reward()['payload'], 'value_in_base':'999'})], order=10), 400)
            check('reward_expense_invalid_values_and_price_override_rejected', await snapshot() == saved)
            await post(envelope('precise-reward', [reward('0.000000000000000001')], order=10))
            qty = await sql('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=$1', reward_position)
            check('reward_preserves_eighteenth_decimal', Decimal(qty) == Decimal('15.000000000000000001'))
            await post(envelope('precise-expense', [expense('0.000000000000000001')], order=11))
            check('expense_preserves_eighteenth_decimal', (await basis(reward_position))['quantity_now'] == 15)
            # Unknown and estimated costs must survive both directions.
            await sql("UPDATE budgeting.portfolio_positions SET metadata=metadata || '{\"basis_quality\":\"unknown\"}' WHERE id=$1", reward_position)
            unknown = await post(envelope('unknown-reward-expense', [reward(), expense()], order=12))
            check('unknown_cost_not_replaced_by_reward_zero', (await basis(reward_position))['remaining_cost_basis'] is None and unknown['results'][1]['consumed_cost_basis'] is None)
            await post(envelope('close-unknown', [expense('20')], order=13))
            check('full_expense_closes_quantity', await sql('SELECT quantity=0 AND status=\'closed\' FROM budgeting.portfolio_positions WHERE id=$1', reward_position))
            reopened = await post(envelope('reward-after-close', [reward()], order=14))
            new_position = reopened['results'][0]['position_id']
            check('new_reward_after_close_has_own_zero_cost', new_position != reward_position and (await basis(new_position))['basis_quality'] == 'confirmed_zero')
            await sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":1000,\"basis_quality\":\"estimated\"}' WHERE position_id=$1", new_position)
            estimated = await post(envelope('estimated-reward-expense', [reward(), expense(position=new_position)], order=15))
            check('estimated_cost_propagates', estimated['results'][1]['basis_quality'] == 'estimated' and (await basis(new_position))['basis_quality'] == 'estimated' and (await basis(new_position))['remaining_cost_basis'] == 750)
            saved = await snapshot()
            await post(envelope('foreign-reward', [reward(account=33)], order=16), 400)
            check('foreign_reward_rejected', await snapshot() == saved)
            # No cash operation is fabricated for a free in-kind reward or consumption.
            check('new_commands_do_not_create_cash_operations', all(x['ledger_table']=='portfolio_events' for x in reward_result['links']+spend['links']))
            # Same family event seen by two members has one owner-scoped key.
            await sql("INSERT INTO budgeting.families VALUES(1)")
            await sql("INSERT INTO budgeting.bank_accounts VALUES(44,'Family','family',NULL,1,'investment','crypto',true)")
            await sql("CREATE OR REPLACE FUNCTION budgeting.has__owner_access(bigint,text,bigint,bigint) RETURNS boolean LANGUAGE sql AS $$SELECT ($2='user' AND $1=$3) OR ($2='family' AND $4=1 AND $1 IN (1,2))$$")
            family_position = await sql('''INSERT INTO budgeting.portfolio_positions(owner_type,owner_family_id,investment_account_id,asset_type_code,title,quantity,amount_in_currency,currency_code,metadata,created_by_user_id)
                VALUES('family',1,44,'crypto','TON',10,0,'RUB','{"crypto_asset_id":1,"asset_symbol":"TON"}',1) RETURNING id''')
            await sql("INSERT INTO budgeting.portfolio_events(position_id,event_type,quantity,metadata,created_by_user_id) VALUES($1,'open',10,'{\"entry_value_in_base\":1000}',1)", family_position)
            family = {**envelope('family-source', [fee(position=family_position)]), 'anchor_account_id': 44}
            family_result = await post(family)
            app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=2)
            check('family_members_share_deduplication_scope', await post(family) == family_result)
            family_flow = {**envelope('family-reward-expense', [reward('1', account=44),
                expense('1', position=family_position)], order=1), 'anchor_account_id': 44}
            family_flow_result = await post(family_flow)
            check('family_reward_expense_preserves_owner_and_basis',
                  family_flow_result['results'][1]['consumed_cost_basis'] == 90
                  and (await basis(family_position))['remaining_cost_basis'] == 810)

    finally:
        await crypto.ledger.close()
    report = {'scope': 'Disposable SQL fixture + real HTTP/storage; synthetic identities', 'checks': checks,
              'passed': len(checks), 'total': len(checks)}
    (socket/'source-event-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(f"Source journal HTTP checks passed: {len(checks)}/{len(checks)}")


if __name__ == '__main__':
    asyncio.run(main())
