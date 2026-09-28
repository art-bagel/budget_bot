"""Opt-in local rollback tests: sub-atomic financing may enter bank custody."""
import asyncio
from datetime import timedelta
from decimal import Decimal
import json
import os
from uuid import uuid4

import asyncpg
from check_user_history import fingerprint
from prepare_docker_history import ROOT, UID, credentials


async def main():
    if os.environ.get('CRYPTO_TEST_LOCAL_ROLLBACK') != '1':
        raise SystemExit('Set CRYPTO_TEST_LOCAL_ROLLBACK=1 for local rollback checks')
    db = await asyncpg.connect(**{**credentials(), 'database': 'budget_bot'})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    before = await fingerprint(db)
    try:
        for symbol, fraction, succeeds in [('USDC','0.000000003',True), ('USDC','0.000001',False),
                                           ('TON','0.0000000005',True), ('TON','0.000000001',False)]:
            tx = db.transaction()
            await tx.start()
            try:
                await db.execute((ROOT/'infra/db/Scripts/budgeting/func/put__crypto_source_event.sql').read_text())
                loan = await db.fetchval('''select p.id from budgeting.crypto_protocol_positions p
                    join budgeting.crypto_assets a on a.id=(p.metadata->>'borrowed_crypto_asset_id')::bigint
                    where p.owner_user_id=$1 and a.symbol=$2 and p.metadata->>'funding_policy'='components' order by p.id desc limit 1''', UID, symbol)
                assert loan is not None
                position = await db.fetchrow('''select p.id,p.quantity,p.investment_account_id,p.metadata from budgeting.portfolio_positions p
                    join budgeting.bank_accounts a on a.id=p.investment_account_id
                    where a.owner_user_id=$1 and p.asset_type_code='crypto' and p.status='open' and p.quantity>1
                    order by p.id limit 1''', UID)
                old_units = await db.fetchval("select coalesce(jsonb_object_agg(key,value #>> '{}'),'{}'::jsonb) from budgeting.portfolio_positions p cross join lateral jsonb_each(coalesce(p.metadata->'funding_units','{}')) u where p.id=$1", position['id'])
                units = {str(loan): fraction}
                await db.execute("update budgeting.portfolio_positions set metadata=jsonb_set(metadata,'{funding_units}',$2) where id=$1",
                                 position['id'], units)
                # Keep the fixture's global financing equation exact, including
                # components removed from the selected holding. All rolls back.
                for key in set(old_units) | set(units):
                    delta = Decimal(str(units.get(key, 0))) - Decimal(str(old_units.get(key, 0)))
                    await db.execute("""update budgeting.crypto_protocol_positions set metadata=jsonb_set(metadata,'{borrowed_quantity}',
                        to_jsonb((metadata->>'borrowed_quantity')::numeric+$2::numeric)) where id=$1""", int(key), delta)
                at = await db.fetchval('select max(occurred_at) from budgeting.crypto_source_events where owner_key=$1','user:'+str(UID))
                at += timedelta(seconds=1)
                commands = [dict(kind='bank_withdraw',payload=dict(position_id=position['id'],bank_account_id=73,quantity=str(position['quantity'])))]
                try:
                    result = await db.fetchval('select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                        UID,position['investment_account_id'],'rollback-dust-test',str(uuid4()),at,0,at.date(),commands,{})
                except asyncpg.RaiseError as e:
                    if succeeds or 'Settle financing' not in str(e):
                        raise
                else:
                    assert succeeds, 'A full atomic unit must not enter unsupported bank financing'
                    carried = await db.fetchval('''select sum((e.metadata->'funding_units'->>$2)::numeric)
                        from budgeting.portfolio_events e join budgeting.crypto_source_event_links l
                        on l.ledger_table='portfolio_events' and l.ledger_id=e.id
                        where l.source_event_id=$1 and e.metadata->>'funding_bank_withdrawal'='true' ''',
                        int(result['source_event_id']), str(loan))
                    assert carried == Decimal(fraction), (carried, fraction)
                print(symbol, fraction, 'allowed and preserved' if succeeds else 'rejected')
            finally:
                await tx.rollback()
        assert await fingerprint(db) == before, 'Rollback changed financial tables'
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())
