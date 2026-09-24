"""Prepare only the local Docker preview for a reviewed, income-free replay.

Legacy crypto records are archived transactionally before replacement. Other
owners, securities and noncrypto ledger records are retained byte-for-byte.
Never connects to the visible dev database or production.
"""

import asyncio
from collections import defaultdict
from decimal import Decimal as D
import json
from pathlib import Path
import subprocess

import asyncpg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs/crypto-docker-migration"
UID = 478559604
BANK = 73
DB = "crypto_merge_preview"


def credentials():
    values = json.loads(
        subprocess.check_output(
            ["docker", "inspect", "budget_bot_db", "--format", "{{json .Config.Env}}"],
            text=True,
        )
    )
    env = dict(v.split("=", 1) for v in values)
    return dict(
        host="127.0.0.1",
        port=5432,
        database=DB,
        user=env["POSTGRES_USER"],
        password=env["POSTGRES_PASSWORD"],
    )


def corrected_plan(original):
    plan = json.loads(json.dumps(original))
    groups = defaultdict(list)
    changes = []
    for row in plan["rows"]:
        server = row.get("evidence", {}).get("server_purchase")
        if server and row.get("funding_RUB"):
            groups[server.get("server_date", server.get("date"))].append(row)
        for cmd in row["commands"]:
            if cmd["kind"] == "sell_fiat":
                # Keep the internal financing holder until settlement. The
                # portfolio widget is removed; USD remains ordinary bank cash.
                cmd["payload"]["defer_manual_expense"] = True
    for day, rows in groups.items():
        total_qty = sum(
            D(
                next(
                    c["payload"]["quantity"]
                    for c in r["commands"]
                    if c["kind"] == "bank_buy"
                )
            )
            for r in rows
        )
        remaining = D("2835.00")
        for index, row in enumerate(rows):
            buy = next(c["payload"] for c in row["commands"] if c["kind"] == "bank_buy")
            cost = (
                remaining
                if index == len(rows) - 1
                else (D("2835") * D(buy["quantity"]) / total_qty).quantize(D(".01"))
            )
            remaining -= cost
            changes.append(
                dict(
                    source_id=row["source_id"],
                    server_date=day,
                    previous_RUB=row["funding_RUB"],
                    actual_RUB=str(cost),
                )
            )
            row["evidence"]["server_actual_payment_correction"] = dict(
                confirmed_by="owner on 2026-09-24: server always costs 2835 RUB",
                previous_estimate_RUB=row["funding_RUB"],
                payment_RUB="2835.00",
                payment_date=day,
                allocation="same-date split receipts allocated by TON quantity",
                allocated_RUB=str(cost),
                receipts_in_payment=len(rows),
            )
            row["funding_RUB"] = buy["fiat_amount"] = str(cost)
            row["funding_quality"] = "actual"
    assert len(changes) == 17 and len(groups) == 16
    # The August swap is already present; do not create a second acquisition.
    swap = next(r for r in plan["rows"] if r.get("event_no") == 1041)
    assert swap["commands"][0]["payload"]["from_amount"] == "24.1"
    assert swap["commands"][0]["payload"]["to_amount"] == "34.096628"
    swap["evidence"]["owner_confirmation"] = (
        "24.1 TON exchanged to 34.09 USDT for server payment; exact on-chain output retained"
    )
    plan["docker_migration"] = dict(
        server_corrections=changes, no_income=True, original_funding_RUB="2481653.33"
    )
    return plan


async def connect():
    db = await asyncpg.connect(**credentials())
    for kind in ["json", "jsonb"]:
        await db.set_type_codec(
            kind,
            encoder=lambda v: json.dumps(v, default=str),
            decoder=json.loads,
            schema="pg_catalog",
        )
    assert await db.fetchval("select current_database()") == DB
    return db


async def main():
    original = json.loads(
        (ROOT / "outputs/crypto-final-block-dev/plan-1049.json").read_text()
    )
    plan = corrected_plan(original)
    inv = json.loads((OUT / "inventory.json").read_text())
    opids = sorted(
        {e["operation_id"] for e in inv["crypto_bank_entries"]}
        | {e["linked_operation_id"] for e in inv["events"]}
    )
    assert None not in opids
    funding = sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
    already = D("228671.00")
    released = funding - already
    residual = D("7566438") - released
    db = await connect()
    try:
        async with db.transaction():
            await db.execute("select pg_advisory_xact_lock($1)", UID)
            await db.execute("create schema if not exists crypto_migration_audit")
            await db.execute(
                "create table if not exists crypto_migration_audit.preparation (id integer primary key, payload jsonb not null)"
            )
            saved = await db.fetchval(
                "select payload from crypto_migration_audit.preparation where id=1"
            )
            if saved:
                assert saved["funding_RUB"] == str(funding)
                (OUT / "plan-docker.json").write_text(
                    json.dumps(saved["plan"], ensure_ascii=False, indent=2) + "\n"
                )
                if not (OUT / "state-preview.json").exists():
                    (OUT / "state-preview.json").write_text(
                        json.dumps(saved["state"], ensure_ascii=False, indent=2) + "\n"
                    )
                print("Already prepared; no database changes")
                return
            assert await db.fetchval(
                "select count(*) from budgeting.operations where id=any($1::bigint[]) and owner_user_id=$2",
                opids,
                UID,
            ) == len(opids)
            assert (
                await db.fetchval("select count(*) from budgeting.crypto_source_events")
                == 0
            )
            original_bank = await db.fetchval(
                "select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='RUB'"
            )
            untouched = await db.fetchval(
                "select md5(string_agg(to_jsonb(o)::text, chr(10) order by id)) from budgeting.operations o where not(id=any($1::bigint[]))",
                opids,
            )
            other_positions = await db.fetchval(
                "select md5(string_agg(to_jsonb(p)::text, chr(10) order by id)) from budgeting.portfolio_positions p where investment_account_id not in (87,92)"
            )
            archive = {}
            filters = {
                "operations": "id=any($1::bigint[])",
                "bank_entries": "operation_id=any($1::bigint[])",
                "budget_entries": "operation_id=any($1::bigint[])",
                "crypto_bank_entries": "operation_id=any($1::bigint[])",
                "crypto_lot_consumptions": "operation_id=any($1::bigint[])",
                "crypto_lots": "opened_by_operation_id=any($1::bigint[])",
                "portfolio_events": "linked_operation_id=any($1::bigint[])",
            }
            for table, where in filters.items():
                archive[table] = await db.fetchval(
                    f"select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from budgeting.{table} t where {where}",
                    opids,
                )
            archive["portfolio_positions"] = await db.fetchval(
                "select jsonb_agg(to_jsonb(p)) from budgeting.portfolio_positions p where investment_account_id in (87,92)"
            )
            # Fail closed if any unrelated FX/security record uses this graph.
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.fx_lots where opened_by_operation_id=any($1::bigint[])",
                    opids,
                )
                == 0
            )
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.lot_consumptions where operation_id=any($1::bigint[])",
                    opids,
                )
                == 0
            )
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.crypto_lot_consumptions c join budgeting.crypto_lots l on l.id=c.lot_id where l.opened_by_operation_id=any($1::bigint[]) and not(c.operation_id=any($1::bigint[]))",
                    opids,
                )
                == 0
            )
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.portfolio_events where position_id in (select id from budgeting.portfolio_positions where investment_account_id in (87,92)) and not(linked_operation_id=any($1::bigint[]))",
                    opids,
                )
                == 0
            )
            for table in [
                "portfolio_events",
                "crypto_lot_consumptions",
                "crypto_bank_entries",
                "bank_entries",
                "budget_entries",
                "crypto_lots",
            ]:
                await db.execute(
                    f"delete from budgeting.{table} where {filters[table]}", opids
                )
            await db.execute(
                "delete from budgeting.portfolio_positions where investment_account_id in (87,92)"
            )
            await db.execute(
                "delete from budgeting.operations where id=any($1::bigint[]) and reversal_of_operation_id is not null",
                opids,
            )
            await db.execute(
                "delete from budgeting.operations where id=any($1::bigint[])", opids
            )
            await db.execute("select budgeting.rebuild_current_balances($1)", UID)
            category = await db.fetchval(
                "select category_id from budgeting.budget_entries where operation_id=19911"
            )
            reversal = await db.fetchval(
                "select budgeting.put__reverse_operation($1,19911,'Перенос криптоистории: восстановление ранее списанных средств, без нового дохода')",
                UID,
            )
            await db.execute(
                "update budgeting.operations set operated_on='2025-12-31' where reversal_of_operation_id=19911"
            )
            replacement = await db.fetchval(
                "select budgeting.put__record_expense($1,73,$2,$3,'RUB','Неучтённые расходы: остаток после восстановления криптопокупок (замена 19911)','2025-12-31'::date)",
                UID,
                category,
                residual,
            )
            telegram = await db.fetchval(
                "insert into budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) values ('user',$1,'Telegram — криптоистория','investment','crypto') returning id",
                UID,
            )
            assets = {}
            for master in [
                "native TON",
                "0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc",
            ]:
                a = plan["assets"][master]
                address = "" if master == "native TON" else master
                assetid = await db.fetchval(
                    "select id from budgeting.crypto_assets where network_code='ton' and contract_address=$1 and symbol=$2 limit 1",
                    address,
                    a["symbol"],
                )
                if assetid is None:
                    assetid = await db.fetchval(
                        "insert into budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) values ($1,$1,'ton',$2,$3) returning id",
                        a["symbol"],
                        address,
                        a["decimals"],
                    )
                assets[master] = assetid
            state = dict(
                funding_mode="existing_cash_only",
                user_id=UID,
                accounts=dict(main=92, cold=87, primary_cash=73, telegram=telegram),
                assets=assets,
                database=DB,
                socket="127.0.0.1",
                posted={},
                verified_through=0,
                limitations=[],
            )
            friend = D("96936.80")
            plan["expected_bank_RUB"] = str(original_bank + D("19400") + friend)
            plan["docker_migration"].update(
                funding_RUB=str(funding),
                existing_purchase_RUB=str(already),
                released_RUB=str(released),
                replacement_expense_RUB=str(residual),
                friend_receipts_RUB=str(friend),
                original_bank_RUB=str(original_bank),
                category_id=category,
            )
            payload = dict(
                plan=plan,
                state=state,
                archive=archive,
                original_operation_ids=opids,
                untouched_operations_hash=untouched,
                other_positions_hash=other_positions,
                original_max_operation=await db.fetchval(
                    "select max(id) from budgeting.operations where id not in (select id from budgeting.operations where reversal_of_operation_id=19911)"
                ),
                funding_RUB=str(funding),
                reversal=reversal,
                replacement=replacement,
            )
            await db.execute(
                "insert into crypto_migration_audit.preparation values(1,$1)", payload
            )
        (OUT / "plan-docker.json").write_text(
            json.dumps(plan, ensure_ascii=False, indent=2) + "\n"
        )
        (OUT / "state-preview.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n"
        )
        print(json.dumps(plan["docker_migration"], ensure_ascii=False))
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
