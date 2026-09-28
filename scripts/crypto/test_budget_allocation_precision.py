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
from prepare_docker_history import UID, credentials


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
        # Choose a funded category owned by this local test user, without
        # manufacturing balances or changing the user's intended allocation.
        source = await db.fetchval("select b.category_id from budgeting.current_budget_balances b join budgeting.categories c on c.id=b.category_id where c.owner_user_id=$1 and c.kind='regular' and c.is_active and b.amount>3000 and b.category_id<>90 order by b.amount desc limit 1", UID)
        assert source
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(operations.ledger, 'call_function', side_effect=call):
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
    print('PASS: exact decimal allocations via API/storage; invalid values rejected; all changes rolled back')


if __name__ == '__main__':
    asyncio.run(main())
