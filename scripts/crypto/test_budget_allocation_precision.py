"""Exercise the ordinary allocation API against local review data, with rollback."""
import asyncio
import json
import os
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import asyncpg
import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from check_user_history import fingerprint
from prepare_docker_history import ROOT, UID, credentials


async def main():
    os.environ.setdefault("APP_PORT", "8000")
    os.environ.setdefault("DB_PORT", "5432")
    from backend.app.dependencies import CurrentUser, get_current_user
    from backend.app.routers import operations

    db = await asyncpg.connect(**{**credentials(), 'database': 'crypto_review_20260928'})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    before = await fingerprint(db)
    print('Free budget:', await db.fetchval('select amount from budgeting.current_budget_balances where category_id=88'))
    tx = db.transaction()
    await tx.start()
    app = FastAPI()
    app.include_router(operations.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=UID)

    async def call(function, *args):
        placeholders = ','.join(f'${i+1}' for i in range(len(args)))
        return await db.fetchval(f'SELECT {function}({placeholders})', *args)

    try:
        for name in ('put__allocate_budget', 'put__allocate_group_budget'):
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{name}.sql').read_text())
        # Choose a funded category owned by this local test user, without
        # manufacturing balances or changing the user's intended allocation.
        source = await db.fetchval("select b.category_id from budgeting.current_budget_balances b join budgeting.categories c on c.id=b.category_id where c.owner_user_id=$1 and c.kind='regular' and c.is_active and b.amount>3000 and b.category_id<>90 order by b.amount desc limit 1", UID)
        assert source
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(operations.ledger, 'call_function', side_effect=call):
                free_before = await db.fetchval('select sum(amount) from budgeting.current_budget_balances where category_id in(88,89)')
                fx_before = await db.fetchval('select amount from budgeting.current_budget_balances where category_id=89')
                banks_before = (await fingerprint(db))['bank_entries']
                response = await client.post('/api/v1/operations/allocate', json=dict(from_category_id=88, to_category_id=90, amount_in_base=2745.72))
                assert response.status_code == 200, response.text
                assert await db.fetchval('select sum(amount) from budgeting.current_budget_balances where category_id in(88,89)') == free_before - Decimal('2745.72')
                assert await db.fetchval('select amount from budgeting.current_budget_balances where category_id=89') == fx_before
                assert (await fingerprint(db))['bank_entries'] == banks_before
                # Group allocation must use the same combined availability.
                group = await db.fetchval("insert into budgeting.categories(owner_type,owner_user_id,name,kind) values('user',$1,'Rollback FX group','group') returning id", UID)
                await db.execute('insert into budgeting.group_members(group_id,child_category_id,share) values($1,90,1)', group)
                await db.fetchval('select budgeting.put__allocate_group_budget($1,88,$2,100,null)', UID, group)
                assert await db.fetchval('select sum(amount) from budgeting.current_budget_balances where category_id in(88,89)') == free_before - Decimal('2845.72')
                for from_id, amount in ((88, free_before), (90, Decimal('10000'))):
                    sp = db.transaction()
                    await sp.start()
                    try:
                        await db.fetchval('select budgeting.put__allocate_budget($1,$2,128,$3,null)', UID, from_id, amount)
                        raise AssertionError('Insufficient funds were accepted')
                    except asyncpg.RaiseError as exc:
                        assert 'Insufficient budget' in str(exc), str(exc)
                    finally:
                        await sp.rollback()
                # An FX loss must reduce availability too, never be ignored.
                scenario = db.transaction()
                await scenario.start()
                try:
                    await db.execute('update budgeting.current_budget_balances set amount=case category_id when 88 then 100 else -80 end where category_id in(88,89)')
                    denied = db.transaction()
                    await denied.start()
                    try:
                        await db.fetchval('select budgeting.put__allocate_budget($1,88,90,20.01,null)', UID)
                        raise AssertionError('Negative FX was ignored')
                    except asyncpg.RaiseError as exc:
                        assert 'Insufficient budget' in str(exc)
                    finally:
                        await denied.rollback()
                    await db.fetchval('select budgeting.put__allocate_budget($1,88,90,20,null)', UID)
                    assert await db.fetchval('select sum(amount) from budgeting.current_budget_balances where category_id in(88,89)') == 0
                finally:
                    await scenario.rollback()
                for amount in (2745.72, 0.88, 1.17, 0.01):
                    response = await client.post('/api/v1/operations/allocate', json=dict(from_category_id=source, to_category_id=90, amount_in_base=amount))
                    assert response.status_code == 200, response.text
                    op = response.json()['operation_id']
                    actual = await db.fetchval('select amount from budgeting.budget_entries where operation_id=$1 and category_id=90', op)
                    assert actual == Decimal(str(amount)), (actual, amount)
                for amount in ('NaN', 'Infinity', '-1', '0'):
                    response = await client.post('/api/v1/operations/allocate', json=dict(from_category_id=source, to_category_id=90, amount_in_base=amount))
                    assert response.status_code == 422, response.text
                # Other callers (including the bot) may still send Python floats.
                op = await operations.ledger.put__allocate_budget(UID, source, 90, 0.29)
                assert await db.fetchval('select amount from budgeting.budget_entries where operation_id=$1 and category_id=90', op) == Decimal('0.29')
    finally:
        await tx.rollback()
        assert before == await fingerprint(db), 'Test changed financial data'
        await db.close()
    print('PASS: combined free/FX and group allocations, overdraft rejection; exact decimal allocations via API/storage; invalid values rejected; all changes rolled back')


if __name__ == '__main__':
    asyncio.run(main())
