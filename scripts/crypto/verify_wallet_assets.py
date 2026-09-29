"""Read-only wallet aggregation acceptance; optional local dev function deployment."""
import argparse
import asyncio
import json
from decimal import Decimal

import asyncpg
from check_user_history import fingerprint
from prepare_docker_history import ROOT, UID, credentials


async def run(database, apply):
    assert database in ('budget_bot', 'crypto_legacy_acceptance')
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    tx = db.transaction()
    await tx.start()
    try:
        before = await fingerprint(db)
        base = ROOT / 'infra/db/Scripts/budgeting'
        await db.execute((base / 'tb/crypto_asset_visibility.sql').read_text())
        for name in ('is__crypto_audit_comment', 'get__crypto_wallet_asset_summary', 'get__crypto_asset_detail', 'get__crypto_account_assets', 'set__crypto_asset_hidden'):
            await db.execute((base / 'func' / f'{name}.sql').read_text())
        checked = zeros = 0
        accounts = await db.fetch("select id from budgeting.bank_accounts where owner_user_id=$1 and is_active and account_kind='investment' and investment_asset_type='crypto'", UID)
        for account in accounts:
            assets = await db.fetchval('select budgeting.get__crypto_account_assets($1,$2)', UID, account['id'])
            assert len(assets) == len({a['crypto_asset_id'] for a in assets})
            for asset in assets:
                aid = asset['crypto_asset_id']
                detail = await db.fetchval('select budgeting.get__crypto_asset_detail($1,$2,$3)', UID, account['id'], aid)
                raw = await db.fetchrow("""select coalesce(sum(case when status='open' then quantity else 0 end),0) qty,
                    (select count(*) from budgeting.portfolio_events e join budgeting.portfolio_positions p on p.id=e.position_id
                     where p.investment_account_id=$1 and p.asset_type_code='crypto' and p.metadata->>'crypto_asset_id'=$2) events
                    from budgeting.portfolio_positions where investment_account_id=$1 and asset_type_code='crypto' and metadata->>'crypto_asset_id'=$2""", account['id'], str(aid))
                assert abs(Decimal(str(detail['quantity'])) - raw['qty']) < Decimal('1e-10')
                assert len(detail['entries']) == raw['events']
                summaries = await db.fetch("select budgeting.get__crypto_position_entry_summary(id) s from budgeting.portfolio_positions where investment_account_id=$1 and asset_type_code='crypto' and metadata->>'crypto_asset_id'=$2 and status='open'", account['id'], str(aid))
                if all(row['s']['remaining_cost_basis'] is not None for row in summaries):
                    expected = sum(Decimal(str(row['s']['remaining_cost_basis'])) for row in summaries)
                    assert abs(Decimal(str(detail['remaining_cost_basis'])) - expected) < Decimal('0.000001')
                else:
                    assert detail['remaining_cost_basis'] is None

                checked += 1
                save = db.transaction()
                await save.start()
                # Any coin, empty or not, can be hidden; only the display flag changes.
                await db.fetchval('select budgeting.set__crypto_asset_hidden($1,$2,$3,true)', UID, account['id'], aid)
                hidden = await db.fetchval('select budgeting.get__crypto_asset_detail($1,$2,$3)', UID, account['id'], aid)
                assert hidden['is_hidden']
                assert {k: v for k, v in hidden.items() if k != 'is_hidden'} == {k: v for k, v in detail.items() if k != 'is_hidden'}
                await db.fetchval('select budgeting.set__crypto_asset_hidden($1,$2,$3,false)', UID, account['id'], aid)
                restored = await db.fetchval('select budgeting.get__crypto_asset_detail($1,$2,$3)', UID, account['id'], aid)
                assert not restored['is_hidden']
                zeros += raw['qty'] == 0

                await save.rollback()
        # Authorization is enforced on both reads and visibility writes.
        if accounts and assets:
            save = db.transaction()
            await save.start()
            try:
                await db.fetchval('select budgeting.set__crypto_asset_hidden($1,$2,$3,true)', -1, account['id'], aid)
                raise AssertionError('Missing owner check')
            except asyncpg.RaiseError as error:
                assert 'Access denied' in str(error)
            finally:
                await save.rollback()
        assert before == await fingerprint(db)
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        print(json.dumps(dict(database=database, applied=apply, wallet_assets=checked, empty_assets=zeros, financial_data_unchanged=True)))
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='crypto_legacy_acceptance')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
