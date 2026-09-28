"""Install account statistics settings on local dev; never edit financial entries."""

import asyncio
import json
import asyncpg
from prepare_docker_history import credentials, ROOT
from check_user_history import fingerprint

FUNCTIONS = (
    "set__account_statistics",
    "get__bank_accounts",
    "get__portfolio_summary",
    "get__portfolio_analytics",
)


async def main():
    db = await asyncpg.connect(**{**credentials(), "database": "budget_bot"})
    out = ROOT / "outputs/account-statistics"
    out.mkdir(parents=True, exist_ok=True)
    async with db.transaction():
        before = await fingerprint(db)
        accounts = await db.fetchval(
            "select jsonb_agg(to_jsonb(a))::text from budgeting.bank_accounts a"
        )
        backup = out / "accounts-before.json"
        if not backup.exists():
            backup.write_text(accounts)
        await db.execute(
            "ALTER TABLE budgeting.bank_accounts ADD COLUMN IF NOT EXISTS include_in_statistics boolean NOT NULL DEFAULT true"
        )
        for name in FUNCTIONS:
            old = await db.fetchval(
                "select pg_get_functiondef(oid) from pg_proc where pronamespace='budgeting'::regnamespace and proname=$1",
                name,
            )
            dest = out / f"{name}-before.sql"
            if old and not dest.exists():
                dest.write_text(old)
            await db.execute(
                (ROOT / f"infra/db/Scripts/budgeting/func/{name}.sql").read_text()
            )
        after = await fingerprint(db)
        assert all(before[t] == after[t] for t in before if t != "bank_accounts")
        old_accounts = json.loads(accounts)
        new_accounts = json.loads(
            await db.fetchval(
                "select jsonb_agg(to_jsonb(a)-'include_in_statistics')::text from budgeting.bank_accounts a"
            )
        )
        assert [
            {k: v for k, v in a.items() if k != "include_in_statistics"}
            for a in old_accounts
        ] == new_accounts
    await db.close()
    print(
        "Installed statistics functions in local dev. All financial entries unchanged; existing accounts retain their settings."
    )


if __name__ == "__main__":
    asyncio.run(main())
