"""Classify three documented import boundaries on local dev; preserve all ledger rows."""
import argparse
import asyncio
import json

import asyncpg
from check_user_history import fingerprint
from prepare_docker_history import ROOT, UID, credentials

KEYS = ('refund_766', 'service_call_726', 'service_call_728')


async def run(database, apply):
    assert database in ('budget_bot', 'crypto_merge_preview')
    state = json.loads((ROOT / 'outputs/crypto-docker-migration/state-preview.json').read_text())
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    out = ROOT / 'outputs/crypto-ui-final'
    out.mkdir(parents=True, exist_ok=True)
    tx = db.transaction()
    await tx.start()
    try:
        before = await fingerprint(db)
        accounts_before = [dict(r) for r in await db.fetch('select * from budgeting.bank_accounts order by id')]
        changed = []
        for key in KEYS:
            account_id = state['accounts'][key]
            account = await db.fetchrow('select * from budgeting.bank_accounts where id=$1 for update', account_id)
            assert account['owner_user_id'] == UID and account['name'] == key
            assert account['account_kind'] == 'investment' and account['investment_asset_type'] == 'crypto'
            assert account['provider_name'] in (None, 'reconstruction_internal')
            positions = await db.fetch('select * from budgeting.portfolio_positions where investment_account_id=$1', account_id)
            assert positions
            for pos in positions:
                assert pos['status'] == 'closed' and pos['quantity'] == 0
                summary = json.loads(await db.fetchval('select budgeting.get__crypto_position_entry_summary($1)', pos['id']))
                assert not summary.get('remaining_cost_basis') and not summary.get('funding_units')
            assert not await db.fetchval('select count(*) from budgeting.crypto_protocol_positions where investment_account_id=$1', account_id)
            assert not await db.fetchval('select count(*) from budgeting.bank_entries where bank_account_id=$1', account_id)
            await db.execute("update budgeting.bank_accounts set provider_name='reconstruction_internal' where id=$1", account_id)
            changed.append(account_id)
        after = await fingerprint(db)
        assert all(before[t] == after[t] for t in before if t != 'bank_accounts')
        accounts_after = [dict(r) for r in await db.fetch('select * from budgeting.bank_accounts order by id')]
        expected = [{**a, **({'provider_name': 'reconstruction_internal'} if a['id'] in changed else {})} for a in accounts_before]
        assert accounts_after == expected
        visible = json.loads(await db.fetchval('select budgeting.get__bank_accounts($1,NULL,NULL)', UID))
        assert not set(changed) & {a['id'] for a in visible}
        backup = out / f'{database}-accounts-before.json'
        if not backup.exists():
            backup.write_text(json.dumps(accounts_before, default=str, ensure_ascii=False, indent=2))
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        report = dict(database=database, applied=apply, accounts=changed, unchanged_financial_tables=16)
        (out / f'{database}-classification.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    except BaseException:
        await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', choices=('budget_bot', 'crypto_merge_preview'), default='crypto_merge_preview')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
