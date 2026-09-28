"""Install bank replay functions in local dev, proving accounting rows unchanged.

No data adoption or production connection. Default rolls back; --apply commits
only function definitions. Old legacy sources stay locked without their audit.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import json

import asyncpg

from check_user_history import TABLES
from prepare_docker_history import ROOT, credentials

FUNCTIONS = (
    'put__execute_bank_journal_command', 'put__journal_bank_operation',
    'put__crypto_source_event', 'put__crypto_funding_components',
    'get__crypto_correction_fields', 'put__record_expense',
    'put__record_crypto_expense', 'put__allocate_budget',
    'put__buy_crypto_asset', 'put__settle_crypto_fiat_sale',
)
CHECK_TABLES = TABLES + (
    'crypto_liability_events', 'crypto_protocol_accrual_events',
    'categories', 'users', 'crypto_source_mutations', 'crypto_source_revisions',
    'crypto_source_corrections',
)


async def run(database, apply):
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    out = ROOT / 'outputs/crypto-bank-journal'
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    tx = db.transaction()
    await tx.start()
    try:
        # Acquire existing owner journal locks before table locks, like correction.
        for row in await db.fetch('select distinct owner_key from budgeting.crypto_source_events order by owner_key'):
            await db.execute("select pg_advisory_xact_lock(hashtextextended('crypto-source:'||$1,0))",row['owner_key'])
        lock_order = ('bank_accounts', 'portfolio_positions', 'portfolio_events',
            'crypto_protocol_positions', 'crypto_liability_events', 'crypto_protocol_accrual_events',
            'operations', 'bank_entries', 'budget_entries', 'fx_lots', 'lot_consumptions',
            'crypto_lots', 'crypto_lot_consumptions', 'crypto_bank_entries',
            'current_crypto_balances', 'current_bank_balances', 'current_budget_balances',
            'crypto_source_event_links', 'crypto_source_events')
        for table in lock_order:
            await db.execute(f'LOCK TABLE budgeting.{table} IN SHARE ROW EXCLUSIVE MODE')
        async def hashes():
            return {table: await db.fetchval(f"""select md5(coalesce(string_agg(
                row_to_json(t)::text,E'\n' order by row_to_json(t)::text),''))
                from budgeting.{table} t""") for table in CHECK_TABLES}
        before = await hashes()
        definitions = {}
        for fn in FUNCTIONS:
            definitions[fn] = await db.fetchval('''select pg_get_functiondef(oid)
                from pg_proc where pronamespace='budgeting'::regnamespace and proname=$1''', fn)
        (out / f'{database}-{stamp}-before.json').write_text(json.dumps(definitions, indent=2))
        for fn in FUNCTIONS:
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{fn}.sql').read_text())
        after = await hashes()
        if before != after:
            raise RuntimeError('Function deployment changed accounting data')
        locked = await db.fetchval('select count(*) from budgeting.crypto_source_events where not reversible')
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        report = dict(database=database, applied=apply, unchanged_tables=len(CHECK_TABLES),
                      hashes=after, legacy_sources_still_locked=locked, functions=FUNCTIONS)
        (out / f'{database}-{stamp}-verified.json').write_text(json.dumps(report, indent=2))
        print(json.dumps({k: v for k, v in report.items() if k not in ('hashes', 'functions')}))
    except BaseException:
        if db.is_in_transaction():
            await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=['crypto_merge_preview', 'budget_bot'], required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
