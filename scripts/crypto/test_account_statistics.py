import asyncio
import sys
import json

sys.path.insert(0, "scripts/crypto")
from prepare_docker_history import credentials, ROOT, UID
from check_user_history import fingerprint
import asyncpg

FUNCTIONS = [
    "set__account_statistics",
    "get__bank_accounts",
    "get__portfolio_summary",
    "get__portfolio_analytics",
]


async def main():
    db = await asyncpg.connect(**{**credentials(), "database": "crypto_merge_preview"})
    await db.set_type_codec(
        "jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads
    )
    tx = db.transaction()
    await tx.start()
    try:
        before = await fingerprint(db)
        await db.execute(
            "ALTER TABLE budgeting.bank_accounts ADD COLUMN IF NOT EXISTS include_in_statistics boolean NOT NULL DEFAULT true"
        )
        for fn in FUNCTIONS:
            await db.execute(
                (ROOT / f"infra/db/Scripts/budgeting/func/{fn}.sql").read_text()
            )
        accounts = await db.fetchval(
            "select budgeting.get__bank_accounts($1,true,'investment')", UID
        )
        target = next(a for a in accounts if a["name"].startswith("Подарки и стикеры"))
        aid = target["id"]
        assert target["include_in_statistics"]
        baseline = await db.fetchval(
            "select budgeting.get__crypto_correction_state($1)", aid
        )
        summary = await db.fetchval("select budgeting.get__portfolio_summary($1)", UID)
        assert any(
            a["investment_account_id"] == aid and a["include_in_statistics"]
            for a in summary
        )
        await db.fetchval(
            "select budgeting.set__account_statistics($1,$2,false)", UID, aid
        )
        assert (
            await db.fetchval("select budgeting.get__crypto_correction_state($1)", aid)
            == baseline
        )
        current = await db.fetchval("select budgeting.get__portfolio_summary($1)", UID)
        assert [dict(a, include_in_statistics=True) for a in current] == summary
        assert any(
            a["investment_account_id"] == aid and not a["include_in_statistics"]
            for a in current
        )
        assert any(
            a["id"] == aid
            for a in await db.fetchval(
                "select budgeting.get__bank_accounts($1,true,'investment')", UID
            )
        )
        from datetime import date

        analytics = await db.fetchval(
            "select budgeting.get__portfolio_analytics($1,$2,$3)",
            UID,
            date(2024, 1, 1),
            date(2026, 9, 27),
        )

        def ids(obj):
            if isinstance(obj, dict):
                yield from (
                    [obj["investment_account_id"]]
                    if "investment_account_id" in obj
                    else []
                )
                for v in obj.values():
                    yield from ids(v)
            elif isinstance(obj, list):
                for v in obj:
                    yield from ids(v)

        assert aid not in list(ids(analytics))
        try:
            async with db.transaction():
                await db.fetchval(
                    "select budgeting.set__account_statistics($1,$2,true)",
                    -991234567,
                    aid,
                )
            raise AssertionError("foreign access allowed")
        except asyncpg.RaiseError:
            pass
        await db.fetchval(
            "select budgeting.set__account_statistics($1,$2,true)", UID, aid
        )
        assert (
            await db.fetchval("select budgeting.get__portfolio_summary($1)", UID)
            == summary
        )
        after = await fingerprint(db)
        assert all(before[t] == after[t] for t in before if t != "bank_accounts")
        print(
            "PASS: exclusion/inclusion, retained history, unchanged amounts/debt/cost, filtered analytics, owner protection; transaction rolled back"
        )
    finally:
        await tx.rollback()
        await db.close()


asyncio.run(main())
