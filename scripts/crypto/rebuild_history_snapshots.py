"""Rebuild legacy source before-images in an isolated local Docker database.

Never replaces a database or changes the visible dev. Reuses the reviewed
income-free preparation and chronological importer. Artifacts contain private
financial data and remain under ignored outputs/. Run with --prepare or --replay.
"""

import argparse
import asyncio
import json
import re
from decimal import Decimal
import subprocess
import sys
import time
from uuid import uuid4

import asyncpg

import prepare_docker_history as preparation

ROOT = preparation.ROOT
OUT = ROOT / "outputs/crypto-history-revisions"
DATABASE = "crypto_revision_preview"
BASELINE = "crypto_before_20260924"


def sql_text(path):
    """Expand the repository's relative psql include directives."""
    return "\n".join(
        sql_text(path.parent / line.split(maxsplit=1)[1])
        if line.startswith("\\ir ")
        else line
        for line in path.read_text().splitlines()
    )


def function_paths():
    script = (ROOT / "infra/db/Scripts/run_func_scripts.sh").read_text()
    priority = re.findall(
        r'"([^"]+\.sql)"', script.split("PRIORITY_FILES=(", 1)[1].split(")", 1)[0]
    )
    paths = {
        p.name: p for p in (ROOT / "infra/db/Scripts/budgeting/func").glob("*.sql")
    }
    return [paths[n] for n in priority] + [
        paths[n] for n in sorted(paths) if n not in priority
    ]


def normalized(value):
    """Ignore only execution timestamps and derived display additions."""
    if isinstance(value, dict):
        return {
            k: normalized(v)
            for k, v in value.items()
            if k
            not in (
                "created_at",
                "updated_at",
                "quantity_exact",
                "current_quantity_exact",
                "token1_quantity_exact",
                "collateral_position_id",
            )
        }
    if isinstance(value, list):
        return [normalized(v) for v in value]
    return value


async def verify_sources():
    cfg = preparation.credentials()
    fresh = await asyncpg.connect(**{**cfg, "database": DATABASE})
    live = await asyncpg.connect(**{**cfg, "database": "budget_bot"})
    try:
        query = "select to_jsonb(s)-'created_at'-'reversible' data from budgeting.crypto_source_events s order by id"
        rebuilt, existing = await fresh.fetch(query), await live.fetch(query)
        if len(rebuilt) != 1960 or len(existing) != len(rebuilt):
            raise RuntimeError("Expected the complete reviewed 1960-source history")
        for a, b in zip(rebuilt, existing, strict=True):
            av, bv = (json.loads(r["data"], parse_float=Decimal) for r in (a, b))
            av["result"] = normalized(av["result"])
            bv["result"] = normalized(bv["result"])
            if av != bv:
                raise RuntimeError(
                    f"Source differs beyond timestamps/display fields: {av['id']}"
                )
        count = await fresh.fetchval(
            "select count(*) from budgeting.crypto_source_mutations"
        )
        assert (
            await fresh.fetchval(
                "select count(*) from budgeting.crypto_source_events where reversible"
            )
            == 1960
        )
        without_writes = await fresh.fetch("""
            select commands,result from budgeting.crypto_source_events s
            where not exists(select 1 from budgeting.crypto_source_mutations m where m.source_event_id=s.id)
        """)
        for source in without_writes:
            commands = json.loads(source["commands"])
            result = json.loads(source["result"])
            assert all(c["kind"] == "observation" for c in commands)
            assert result["links"] == []
            assert all(r["economic_change"] is False for r in result["results"])
        report = dict(
            sources=1960,
            identical_ids_commands_evidence_links=True,
            captured_mutations=count,
            observation_only_sources=len(without_writes),
            visible_dev_changed=False,
        )
        (OUT / "source-proof.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        await fresh.close()
        await live.close()


async def test_correction():
    """Exercise the complete prefix before non-journal finalization is applied."""
    from check_user_history import TABLES

    db = await asyncpg.connect(**{**preparation.credentials(), "database": DATABASE})
    try:
        if await db.fetchval(
            "select exists(select 1 from crypto_migration_audit.preparation where id=2)"
        ):
            raise RuntimeError(
                "Run this test before --finish; finalized bank tails are intentionally protected."
            )

        async def fingerprint():
            return {
                table: await db.fetchval(f"""select md5(coalesce(string_agg(
                to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),''))
                from budgeting.{table} t""")
                for table in (
                    *TABLES,
                    "crypto_liability_events",
                    "crypto_protocol_accrual_events",
                )
            }

        before = await fingerprint()
        started = time.monotonic()
        report = json.loads(
            await db.fetchval(
                "select budgeting.put__correct_crypto_source($1,1,1,$2,$3,$4,false,null)",
                preparation.UID,
                uuid4(),
                json.dumps(
                    [dict(command_index=0, field="fiat_amount", value="1030.00")]
                ),
                "Isolated full-history correction test",
            )
        )
        assert report["replayed_sources"] == 1960 and report["applied"] is False
        assert before == await fingerprint(), "Preview changed existing accounting data"
        result = dict(
            replayed_sources=1960,
            unchanged_tables=19,
            elapsed_seconds=round(time.monotonic() - started, 3),
            preview=report,
        )
        (OUT / "full-correction-test.json").write_text(json.dumps(result, indent=2))
        print("Full 1960-source preview succeeded; all 19 financial tables unchanged.")
    finally:
        await db.close()


async def finish():
    # Retain the reviewed card categorization, friend proceeds and post-cutoff
    # operations through their existing business functions. No new income.
    cfg = preparation.credentials()
    preparation.DB = DATABASE
    preparation.OUT = OUT
    preparation.credentials = lambda: {**cfg, "database": DATABASE}
    import finish_docker_history

    await finish_docker_history.main()


async def prepare():
    cfg = preparation.credentials()
    OUT.mkdir(parents=True, exist_ok=True)
    admin = await asyncpg.connect(**{**cfg, "database": "postgres"})
    try:
        if await admin.fetchval(
            "select exists(select 1 from pg_database where datname=$1)", DATABASE
        ):
            raise RuntimeError(
                "Sandbox already exists; refusing to overwrite it. Use --replay to resume."
            )
        await admin.execute(f"CREATE DATABASE {DATABASE} TEMPLATE {BASELINE}")
    finally:
        await admin.close()
    db = await asyncpg.connect(**{**cfg, "database": DATABASE})
    try:
        for path in sorted(
            (ROOT / "infra/db/Scripts/budgeting/migrations").glob("*.sql")
        ):
            if not await db.fetchval(
                "select exists(select 1 from budgeting.schema_migrations where filename=$1)",
                path.name,
            ):
                async with db.transaction():
                    await db.execute(sql_text(path))
                    await db.execute(
                        "insert into budgeting.schema_migrations(filename) values($1)",
                        path.name,
                    )
        for path in function_paths():
            await db.execute(sql_text(path))
    finally:
        await db.close()
    (OUT / "inventory.json").write_bytes(
        (preparation.OUT / "inventory.json").read_bytes()
    )
    preparation.DB = DATABASE
    preparation.OUT = OUT
    preparation.credentials = lambda: {**cfg, "database": DATABASE}
    await preparation.main()


def replay():
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/crypto/replay_first_block_dev.py"),
            "--socket",
            "127.0.0.1",
            "--port",
            "5432",
            "--database",
            DATABASE,
            "--docker-preview",
            "--plan",
            str(OUT / "plan-docker.json"),
            "--state",
            str(OUT / "state-preview.json"),
            "--checkpoint-every",
            "100",
            "--verify-capital-each-source",
        ],
        check=True,
        cwd=ROOT,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--replay", action="store_true")
    mode.add_argument("--verify-sources", action="store_true")
    mode.add_argument("--finish", action="store_true")
    mode.add_argument("--test-correction", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        asyncio.run(prepare())
    elif args.replay:
        replay()
    elif args.verify_sources:
        asyncio.run(verify_sources())
    elif args.test_correction:
        asyncio.run(test_correction())
    else:
        asyncio.run(finish())
