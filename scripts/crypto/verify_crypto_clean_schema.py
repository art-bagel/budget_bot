"""Check current table/function scripts on an isolated empty local PG17 database.

Creates crypto_schema_acceptance once; reruns only reapply idempotent DDL there.
Reads budget_bot for schema comparison, never modifies it or copies user data.
Private comparison output remains in outputs/crypto-history-revisions/.
"""

import asyncio
import asyncpg
import re
import json
from collections import Counter
from prepare_docker_history import credentials, ROOT
from rebuild_history_snapshots import sql_text

OUT = ROOT / "outputs/crypto-history-revisions"


async def main():
    cfg = credentials()
    admin = await asyncpg.connect(**{**cfg, "database": "postgres"})
    if not await admin.fetchval(
        "select exists(select 1 from pg_database where datname='crypto_schema_acceptance')"
    ):
        await admin.execute("CREATE DATABASE crypto_schema_acceptance")
    await admin.close()
    db = await asyncpg.connect(**{**cfg, "database": "crypto_schema_acceptance"})
    await db.execute("create schema if not exists budgeting")
    text = (
        (ROOT / "infra/db/Scripts/run_table_scripts.sh")
        .read_text()
        .split("FILES=(", 1)[1]
        .split(")", 1)[0]
    )
    names = re.findall(r'"([^"]+\.sql)"', text)
    assert set(names) == {
        p.name for p in (ROOT / "infra/db/Scripts/budgeting/tb").glob("*.sql")
    }
    for name in names:
        await db.execute(sql_text(ROOT / "infra/db/Scripts/budgeting/tb" / name))
    priority = re.findall(
        r'"([^"]+\.sql)"',
        (ROOT / "infra/db/Scripts/run_func_scripts.sh")
        .read_text()
        .split("PRIORITY_FILES=(", 1)[1]
        .split(")", 1)[0],
    )
    paths = {
        p.name: p for p in (ROOT / "infra/db/Scripts/budgeting/func").glob("*.sql")
    }
    for p in [paths[n] for n in priority] + [
        paths[n] for n in sorted(paths) if n not in priority
    ]:
        try:
            await db.execute(sql_text(p))
        except Exception:
            print("FAIL", p.name)
            raise
    live = await asyncpg.connect(**{**cfg, "database": "budget_bot"})
    queries = {
        "columns": "select table_name,column_name,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale from information_schema.columns where table_schema='budgeting' and table_name<>'schema_migrations' order by table_name,ordinal_position",
        "constraints": "select c.relname,t.conname,pg_get_constraintdef(t.oid) def from pg_constraint t join pg_class c on c.oid=t.conrelid where c.relnamespace='budgeting'::regnamespace and c.relname<>'schema_migrations' order by 1,2",
        "indexes": "select tablename,indexname,indexdef from pg_indexes where schemaname='budgeting' and tablename<>'schema_migrations' order by 1,2",
    }
    report = {}
    for key, q in queries.items():
        a = [dict(r) for r in await db.fetch(q)]
        b = [dict(r) for r in await live.fetch(q)]
        report[key] = {
            "fresh_only": [x for x in a if x not in b],
            "upgraded_only": [x for x in b if x not in a],
        }

    def constraint_key(row):
        definition = re.sub(
            r"\('([^']*)'::character varying\)::text", r"'\1'::text", row["def"]
        )
        definition = re.sub(
            r"\(ARRAY\[((?:'[^']*'::character varying(?:, )?)+)\]\)::text\[\]",
            lambda m: "ARRAY[" + m[1].replace("::character varying", "::text") + "]",
            definition,
        )
        return row["relname"], definition

    (OUT / "clean-schema.json").write_text(json.dumps(report, indent=2, default=str))
    assert not any(report["columns"].values())
    assert not any(report["indexes"].values())
    assert Counter(map(constraint_key, report["constraints"]["fresh_only"])) == Counter(
        map(constraint_key, report["constraints"]["upgraded_only"])
    )
    report["constraints"]["equivalent"] = True
    report["postgres_version"] = await db.fetchval("show server_version")
    (OUT / "clean-schema.json").write_text(json.dumps(report, indent=2, default=str))
    print(
        "Clean schema columns, indexes and constraint expressions match upgraded dev."
    )
    await live.close()
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
