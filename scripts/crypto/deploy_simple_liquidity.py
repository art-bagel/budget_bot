"""Install LP functions in local dev only, asserting existing financial rows unchanged."""
import argparse
import asyncio
import json

import asyncpg
from check_user_history import fingerprint
from prepare_docker_history import ROOT, credentials

FUNCTIONS = (
    'put__crypto_lp_action', 'put__manual_crypto_movement', 'put__crypto_source_event',
    'put__crypto_funding_components', 'put__top_up_crypto_protocol_position',
    'set__close_crypto_protocol_position', 'get__crypto_correction_fields', 'get__crypto_protocol_history',
)


async def run(database, apply):
    assert database in ('budget_bot', 'crypto_merge_preview', 'crypto_legacy_acceptance')
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    out = ROOT / 'outputs/crypto-simple-liquidity'
    out.mkdir(parents=True, exist_ok=True)
    async with db.transaction():
        before = await fingerprint(db)
        for name in FUNCTIONS:
            definition = await db.fetchval("select pg_get_functiondef(oid) from pg_proc where pronamespace='budgeting'::regnamespace and proname=$1", name)
            backup = out / f'{database}-{name}-before.sql'
            if definition and not backup.exists():
                backup.write_text(definition)
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{name}.sql').read_text())
        after = await fingerprint(db)
        assert before == after, 'Financial rows changed'
        if not apply:
            await db.execute('SET CONSTRAINTS ALL IMMEDIATE')
            raise RuntimeError('Use --apply to commit local dev functions; transaction rolled back')
    await db.close()
    report = dict(database=database, functions=list(FUNCTIONS), financial_data_unchanged=True)
    (out / f'{database}-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='budget_bot')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
