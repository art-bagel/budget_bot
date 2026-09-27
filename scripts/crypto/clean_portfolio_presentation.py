"""Verify read-only comment provenance and apply the ordinary UI to local dev.

Audit comments remain in the ledger. Only display functions and two imported
account names change; all other stored rows are fingerprinted before/after.
"""
import argparse
import asyncio
import json

import asyncpg

from check_user_history import fingerprint
from prepare_docker_history import ROOT, UID, credentials

FUNCTIONS = (
    'is__crypto_audit_comment', 'get__crypto_asset_detail', 'get__portfolio_events',
    'get__operations_history', 'get__crypto_protocol_history', 'get__crypto_protocol_positions',
)


def without_display_flags(value):
    if isinstance(value, dict):
        return {k: without_display_flags(v) for k, v in value.items() if k != 'comment_is_system'}
    if isinstance(value, list):
        return [without_display_flags(v) for v in value]
    return value


async def run(database, apply):
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    out = ROOT / 'outputs/crypto-clean-presentation'
    out.mkdir(parents=True, exist_ok=True)
    tx = db.transaction()
    await tx.start()
    try:
        before = await fingerprint(db)
        queries = [('protocols', 'select budgeting.get__crypto_protocol_positions($1)', [UID]), ('operations', 'select budgeting.get__operations_history($1,10000,0)', [UID])]
        for p in await db.fetch("select id from budgeting.crypto_protocol_positions where owner_user_id=$1", UID):
            queries.append((f"protocol:{p['id']}", 'select budgeting.get__crypto_protocol_history($1,$2,200,0)', [UID, p['id']]))
        for p in await db.fetch("select id from budgeting.portfolio_positions where owner_user_id=$1 and asset_type_code='crypto'", UID):
            queries.append((f"position:{p['id']}", 'select budgeting.get__portfolio_events($1,$2)', [UID, p['id']]))
        for p in await db.fetch("select distinct investment_account_id,(metadata->>'crypto_asset_id')::bigint asset from budgeting.portfolio_positions where owner_user_id=$1 and asset_type_code='crypto' and metadata->>'crypto_asset_id' ~ '^[0-9]+$'", UID):
            queries.append((f"asset:{p['investment_account_id']}:{p['asset']}", 'select budgeting.get__crypto_asset_detail($1,$2,$3)', [UID, p['investment_account_id'], p['asset']]))
        original = {name: await db.fetchval(sql, *params) for name, sql, params in queries}
        for fn in FUNCTIONS:
            definition = await db.fetchval("select pg_get_functiondef(oid) from pg_proc where pronamespace='budgeting'::regnamespace and proname=$1", fn)
            backup = out / f'{database}-{fn}-before.sql'
            if definition and not backup.exists():
                backup.write_text(definition)
            await db.execute((ROOT / 'infra/db/Scripts/budgeting/func' / f'{fn}.sql').read_text())
        for name, sql, params in queries:
            updated = await db.fetchval(sql, *params)
            assert without_display_flags(updated) == without_display_flags(original[name]), name
        annotated = await db.fetchval("select count(*) from budgeting.portfolio_events e where e.comment is not null and budgeting.is__crypto_audit_comment('portfolio_events',e.id)")
        assert annotated > 0
        # Change source classification only inside a rolled-back savepoint:
        # same comment must remain visible when entered through the manual path.
        manual_tx = db.transaction()
        await manual_tx.start()
        linked = await db.fetchrow("select s.id,l.ledger_id from budgeting.crypto_source_events s join budgeting.crypto_source_event_links l on l.source_event_id=s.id where s.source_namespace='first-hundred-dev-v1' and l.ledger_table='portfolio_events' limit 1")
        await db.execute("update budgeting.crypto_source_events set source_namespace='manual-portfolio-v1' where id=$1", linked['id'])
        assert not await db.fetchval("select budgeting.is__crypto_audit_comment('portfolio_events',$1)", linked['ledger_id'])
        await manual_tx.rollback()
        assert before == await fingerprint(db), 'Read-only presentation changed stored records'
        accounts_before = {r["id"]: dict(r) for r in await db.fetch("select * from budgeting.bank_accounts")}
        renames = []
        for old, new in [('История main — события 1–1049', 'Основной TON-кошелёк'), ('Telegram — криптоистория', 'Telegram Wallet')]:
            row = await db.fetchrow("update budgeting.bank_accounts set name=$3 where owner_type='user' and owner_user_id=$1 and account_kind='investment' and investment_asset_type='crypto' and name=$2 returning id", UID, old, new)
            if row:
                renames.append(dict(id=row['id'], before=old, after=new))
        expected_accounts = {k: dict(v) for k, v in accounts_before.items()}
        for rename in renames:
            expected_accounts[rename["id"]]["name"] = rename["after"]
        assert expected_accounts == {r["id"]: dict(r) for r in await db.fetch("select * from budgeting.bank_accounts")}
        after = await fingerprint(db)
        assert {k: v for k, v in before.items() if k != 'bank_accounts'} == {k: v for k, v in after.items() if k != 'bank_accounts'}
        report = dict(database=database, applied=apply, checked_responses=len(queries), audit_comments=annotated,
                      manual_comment_preserved=True, stored_financial_rows_unchanged=True, account_renames=renames)
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        (out / f'{database}-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False))
    finally:
        if db.is_in_transaction():
            await tx.rollback()
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', choices=['crypto_legacy_acceptance', 'budget_bot'], default='crypto_legacy_acceptance')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.database, args.apply))
