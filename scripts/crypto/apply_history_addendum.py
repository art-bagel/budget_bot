"""Replay a reviewed local addendum through the source journal, atomically.

Import maintenance only, not an API for editing arbitrary historical operations.
Preserves existing ledger identities, archives source revisions and rejects any
non-journal conflict. Defaults to rollback; never connects to production.
"""
import argparse
import asyncio
from datetime import datetime, date
from decimal import Decimal
import hashlib
import json
from pathlib import Path

import asyncpg
from check_user_history import fingerprint
from prepare_docker_history import ROOT, credentials


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


async def run(plan_path, apply):
    plan = json.loads(plan_path.read_text())
    db = await asyncpg.connect(**{**credentials(), 'database': 'budget_bot'})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    tx = db.transaction(isolation='serializable')
    await tx.start()
    out = plan_path.parent
    try:
        uid = plan['user_id']
        owner = 'user:' + str(uid)
        await db.execute("select pg_advisory_xact_lock(hashtextextended('crypto-source:'||$1,0))", owner)
        before = await fingerprint(db)
        implementation = digest([await asyncio.to_thread(Path(__file__).read_text), (ROOT/'infra/db/Scripts/budgeting/func/put__crypto_source_event.sql').read_text(), (ROOT/'infra/db/Scripts/budgeting/func/put__correct_crypto_source.sql').read_text()])
        unrelated_before = await db.fetchval("select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from budgeting.portfolio_positions p where asset_type_code<>'crypto'")
        if apply:
            preview = json.loads((out / 'addendum-preview.json').read_text())
            if preview['plan_hash'] != digest(plan) or preview['before'] != before or preview.get('implementation_hash') != implementation:
                raise ValueError('Plan or database changed since the successful preview')
            backup = out / 'before-update.dump'
            if not backup.exists() or backup.stat().st_size < 1000:
                raise ValueError('Local dev backup required')
        await db.execute((ROOT / 'infra/db/Scripts/budgeting/func/put__crypto_source_event.sql').read_text())
        start = datetime.fromisoformat(plan['start'])
        old = [dict(r) for r in await db.fetch('''select * from budgeting.crypto_source_events
            where owner_key=$1 and occurred_at >= $2 order by occurred_at,order_in_timestamp''', owner, start)]
        if not old or any(not r['reversible'] for r in old):
            raise ValueError('Every affected source must have a verified reversible journal')
        ids = [r['id'] for r in old]
        edits = {int(k): v for k, v in plan.get('replacements', {}).items()}
        if not set(edits).issubset(ids):
            raise ValueError('Replacement outside the selected suffix')
        # Reuse the existing correction safety checks and exact reverse-mutation
        # restore. Keep one implementation of typed PK matching and drift guards.
        sql = (ROOT / 'infra/db/Scripts/budgeting/func/put__correct_crypto_source.sql').read_text()
        locks = sql[sql.index(' FOREACH t IN ARRAY ARRAY['):sql.index(' -- This token covers')]
        restore = sql[sql.index('  CREATE TEMP TABLE IF NOT EXISTS crypto_replay_identity'):sql.index("  PERFORM set_config('budgeting.crypto_replaying','on',true);")]
        helper = '''CREATE OR REPLACE FUNCTION pg_temp.rewind_crypto_suffix(ids bigint[], anchor bigint)
          RETURNS void LANGUAGE plpgsql AS $f$
          DECLARE src record; m record; actual jsonb; assigns text; predicate text; t text;
          BEGIN SET search_path TO budgeting;
          SELECT anchor AS anchor_account_id INTO src;
        ''' + locks + restore + ' END $f$;'
        await db.execute(helper)
        await db.execute('select pg_temp.rewind_crypto_suffix($1,$2)', ids, plan['anchor_account_id'])
        prefix_before = await db.fetchval('''select md5(string_agg(to_jsonb(s)::text,'' order by id))
            from budgeting.crypto_source_events s where owner_key=$1 and not(id=any($2::bigint[]))''', owner, ids)
        work = []
        for row in old:
            await db.execute('insert into budgeting.crypto_source_revisions(source_event_id,revision,envelope) values($1,$2,$3)', row['id'], row['revision'], json.loads(json.dumps(row, default=str)))
            row.update(edits.get(row['id'], {}))
            if isinstance(row['occurred_at'], str):
                row['occurred_at'] = datetime.fromisoformat(row['occurred_at'])
            if isinstance(row['accounting_date'], str):
                row['accounting_date'] = date.fromisoformat(row['accounting_date'])
            work.append(row)
        for row in plan['sources']:
            work.append({**row, 'id': None, 'created_by_user_id': uid,
                         'occurred_at': datetime.fromisoformat(row['occurred_at']),
                         'accounting_date': date.fromisoformat(row['accounting_date'])})
        work.sort(key=lambda r: (r['occurred_at'], r['order_in_timestamp']))
        results = []
        async def bind(v):
            if isinstance(v, dict) and set(v) == {'wallet_position'}:
                account, asset = v['wallet_position']
                found = await db.fetchval('''select id from budgeting.portfolio_positions
                    where investment_account_id=$1 and asset_type_code='crypto'
                    and (metadata->>'crypto_asset_id')::bigint=$2 and status='open'
                    order by quantity desc,id limit 1''', account, asset)
                if found is None:
                    raise ValueError(f'No open wallet asset: {account}/{asset}')
                return found
            if isinstance(v, dict):
                return {k: await bind(x) for k, x in v.items()}
            if isinstance(v, list):
                return [await bind(x) for x in v]
            return v
        for row in work:
            commands = await bind(row['commands'])
            if row['id'] is not None:
                await db.execute('''update budgeting.crypto_source_events set revision=revision+1,
                    occurred_at=$2,order_in_timestamp=$3,accounting_date=$4,commands=$5,evidence=$6 where id=$1''',
                    row['id'], row['occurred_at'], row['order_in_timestamp'], row['accounting_date'], commands, row['evidence'])
            await db.execute("select set_config('budgeting.crypto_replaying',$1,true)", 'on' if row['id'] else 'off')
            await db.execute("select set_config('budgeting.crypto_replay_source',$1,true)", str(row['id']) if row['id'] else 'missing')
            result = await db.fetchval('select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                row['created_by_user_id'], row['anchor_account_id'], row['source_namespace'], row['source_id'],
                row['occurred_at'], row['order_in_timestamp'], row['accounting_date'], commands, row['evidence'])
            results.append(dict(source_id=row['source_id'], existing=row['id'] is not None, result=result))
            print('verified', row['source_id'], flush=True)
        if await db.fetchval('select count(*) from pg_temp.crypto_replay_identity where not used'):
            raise ValueError('Replay discarded an existing ledger identity')
        prefix_after = await db.fetchval('''select md5(string_agg(to_jsonb(s)::text,'' order by id))
            from budgeting.crypto_source_events s where owner_key=$1 and not(id=any($2::bigint[]))
            and source_namespace<>$3''', owner, ids, plan['namespace'])
        if prefix_before != prefix_after:
            raise ValueError('Historical source prefix changed')
        checks = []
        for check in plan['checks']:
            actual = await db.fetchval(check['sql'], *check.get('args', []))
            tolerance = Decimal(check.get('tolerance', '0'))
            if abs(Decimal(str(actual)) - Decimal(check['expected'])) > tolerance:
                raise ValueError(f"{check['name']}: expected {check['expected']}, got {actual}")
            checks.append(dict(name=check['name'], actual=str(actual), expected=check['expected'], tolerance=str(tolerance)))
        unrelated_after = await db.fetchval("select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from budgeting.portfolio_positions p where asset_type_code<>'crypto'")
        if unrelated_after != unrelated_before:
            raise ValueError('Noncrypto portfolio changed')
        after = await fingerprint(db)
        if before['bank_accounts'] != after['bank_accounts']:
            raise ValueError('Account configuration changed')
        report = dict(applied=apply, plan_hash=digest(plan), implementation_hash=implementation, before=before, after=after, noncrypto_unchanged=True,
                      existing_replayed=len(old), added=len(plan['sources']), checks=checks, results=results)
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        (out / ('addendum-applied.json' if apply else 'addendum-preview.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        print(json.dumps(dict(applied=apply, replayed=len(old), added=len(plan['sources']), checks=checks)))
    except BaseException:
        if db.is_in_transaction():
            await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.plan, args.apply))
