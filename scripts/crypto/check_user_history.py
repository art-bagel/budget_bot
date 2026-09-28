"""Check simplified user history against every local dev operation; optional deploy.

Only local Docker preview/visible dev are accepted. No ledger records are edited.
Without --apply, function changes are rolled back. Audit data stays in outputs.
"""
import argparse
import asyncio
import json
from datetime import date

import asyncpg

from prepare_docker_history import ROOT, UID, credentials

FUNCTIONS = ('get__operations_history', 'get__bank_accounts',
             'get__portfolio_positions', 'get__portfolio_summary', 'get__portfolio_analytics')
TABLES = ('bank_accounts', 'crypto_source_events', 'crypto_source_event_links',
          'portfolio_positions', 'portfolio_events', 'crypto_protocol_positions',
          'crypto_lots', 'crypto_lot_consumptions', 'fx_lots', 'lot_consumptions',
          'current_crypto_balances', 'current_bank_balances', 'current_budget_balances',
          'operations', 'budget_entries', 'bank_entries', 'crypto_bank_entries')


async def fingerprint(db):
    return {table: await db.fetchval(f"""select md5(coalesce(string_agg(
        row_to_json(t)::text,E'\\n' order by row_to_json(t)::text),''))
        from budgeting.{table} t""") for table in TABLES}


async def run(database, apply):
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    out = ROOT / 'outputs/crypto-user-history'
    out.mkdir(parents=True, exist_ok=True)
    tx = db.transaction()
    await tx.start()
    try:
        before = await fingerprint(db)
        accounts = {r['id']: r['is_archived']
                    for r in await db.fetch('select id,is_archived from budgeting.bank_accounts')}
        internal = {key for key, value in accounts.items() if value}
        # Independently classify the full ledger in Python; no comment/source-name heuristics.
        movements = {}
        for row in await db.fetch('''select linked_operation_id op, investment_account_id account
            from budgeting.portfolio_events e join budgeting.portfolio_positions p on p.id=e.position_id
            where linked_operation_id is not null
            union all select operation_id,bank_account_id from budgeting.bank_entries
            union all select operation_id,bank_account_id from budgeting.crypto_bank_entries'''):
            movements.setdefault(row['op'], set()).add(row['account'])
        hidden = {op for op, ids in movements.items() if ids and ids <= internal}
        all_ops = await db.fetch('''select id,type from budgeting.operations where
            (owner_type='user' and owner_user_id=$1) or
            (owner_type='family' and owner_family_id=budgeting.get__user_family_id($1))''', UID)
        expected = {r['id'] for r in all_ops if r['type'] != 'reversal' and r['id'] not in hidden}
        old_summary = await db.fetchval('select budgeting.get__portfolio_summary($1)', UID)
        for fn in FUNCTIONS:
            backup = out / f'{database}-{fn}-before.sql'
            if not backup.exists():
                definition = await db.fetchval("select pg_get_functiondef(oid) from pg_proc where pronamespace='budgeting'::regnamespace and proname=$1", fn)
                backup.write_text(definition)
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{fn}.sql').read_text())
        rows = []
        offset = 0
        while True:
            page = await db.fetchval('select budgeting.get__operations_history($1,200,$2)', UID, offset)
            if not page['items']:
                break
            assert page['total_count'] == len(expected), 'Pagination total mismatch'
            rows += page['items']
            offset += 200
        ids = [r['operation_id'] for r in rows]
        assert len(ids) == len(set(ids)) and set(ids) == expected
        for row in rows:
            assert all(e['bank_account_id'] not in internal for e in row['bank_entries'])
            assert all(e['investment_account_id'] not in internal for e in row['portfolio_events'])
        for kind in ('banking', 'investment', 'exchange', 'investment_income', 'cancelled'):
            page = await db.fetchval('select budgeting.get__operations_history($1,10000,0,$2)', UID, kind)
            assert not ({r['operation_id'] for r in page['items']} & hidden)
        # All bank-facing operations survive, including purchases, cards, excursion and friend proceeds.
        bank_ops = {r['id'] for r in all_ops if r['type'] != 'reversal'
                    and any(not accounts[a] for a in movements.get(r['id'], set()))}
        assert bank_ops <= set(ids)
        new_summary = await db.fetchval('select budgeting.get__portfolio_summary($1)', UID)
        assert new_summary == [r for r in old_summary if r['investment_account_id'] not in internal]
        positions = await db.fetchval('select budgeting.get__portfolio_positions($1)', UID)
        assert all(p['investment_account_id'] not in internal for p in positions)
        bank_accounts = await db.fetchval('select budgeting.get__bank_accounts($1,NULL,NULL)', UID)
        assert all(a['is_archived'] == (a['id'] in internal) for a in bank_accounts)
        # Run analytics too: no hidden account ids may appear in account-grouped outputs.
        analytics = await db.fetchval('select budgeting.get__portfolio_analytics($1,$2,$3)', UID, date(2024,1,1), date(2026,9,27))
        def check_account_ids(value):
            if isinstance(value, dict):
                assert value.get('investment_account_id') not in internal
                for child in value.values():
                    check_account_ids(child)
            elif isinstance(value, list):
                for child in value:
                    check_account_ids(child)
        check_account_ids(analytics)
        foreign = await db.fetchval('select budgeting.get__operations_history($1,10000,0)', -987654321)
        assert not foreign['items']
        assert before == await fingerprint(db), 'Read-model change modified financial data'
        # Function replacement is repeatable.
        for fn in FUNCTIONS:
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{fn}.sql').read_text())
        assert await db.fetchval('select budgeting.get__portfolio_summary($1)', UID) == new_summary
        report = dict(database=database, applied=apply, visible_operations=len(ids),
                      hidden_operations=len({r['id'] for r in all_ops} & hidden),
                      boundary_and_other_account_operations_preserved=len(bank_ops),
                      unchanged_tables=len(TABLES), fingerprints=before,
                      checks='full history, pagination, five filters, boundary preservation, summary, positions, accounts, analytics, foreign owner, repeat')
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        (out / f'{database}-{"applied" if apply else "check"}.json').write_text(json.dumps(report, indent=2))
        print({k: v for k, v in report.items() if k != 'fingerprints'})
    except BaseException:
        await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=('crypto_merge_preview', 'budget_bot'), default='crypto_merge_preview')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
