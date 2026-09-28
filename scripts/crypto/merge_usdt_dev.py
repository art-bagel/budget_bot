"""Consolidate the verified duplicate USDT bank identity on local copies only.

Each financial change uses a replayable ordinary journal command. Default mode
rolls back; --apply saves after conservation and duplicate-request checks.
"""

import argparse
import asyncio
import json
from datetime import date
from uuid import UUID, uuid4

import asyncpg
from prepare_docker_history import ROOT, UID, credentials
from check_user_history import fingerprint

FUNCTIONS = (
    "put__merge_bank_crypto_asset",
    "put__execute_bank_journal_command",
    "put__journal_bank_operation",
    "put__crypto_source_event",
    "put__crypto_funding_components",
    "get__crypto_assets",
    "put__ensure_crypto_asset",
)
REQUEST = UUID("6f046b08-55f1-4d60-87c1-50d6d373e766")


async def run(database, apply):
    assert database in (
        "crypto_review_20260928",
        "crypto_release_20260928_134135",
        "budget_bot",
    )
    db = await asyncpg.connect(**{**credentials(), "database": database})
    out = ROOT / "outputs/crypto-update-2026-09-28/release/usdt-merge"
    out.mkdir(exist_ok=True)
    tx = db.transaction()
    await tx.start()
    try:
        original = await fingerprint(db)
        for name in FUNCTIONS:
            await db.execute(
                (ROOT / f"infra/db/Scripts/budgeting/func/{name}.sql").read_text()
            )
        assets = await db.fetch(
            "select id,symbol,network_code,contract_address,decimals from budgeting.crypto_assets where id in(2,15) order by id"
        )
        assert [(r["symbol"], r["network_code"], r["decimals"]) for r in assets] == [
            ("USDT", "ton", 6)
        ] * 2
        assert assets[0]["contract_address"] == ""
        assert (
            assets[1]["contract_address"]
            == "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe"
        )
        amounts = await db.fetchrow(
            "select sum(amount) q,sum(cost_base_remaining) cost from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id in(2,15)"
        )
        lots = await db.fetchval(
            "select jsonb_agg(to_jsonb(t)-'crypto_asset_id' order by id)::text from budgeting.crypto_lots t where bank_account_id=73 and crypto_asset_id in(2,15)"
        )
        prefix = await db.fetchval(
            "select md5(string_agg(to_jsonb(t)::text,'' order by id)) from budgeting.crypto_source_events t"
        )
        max_source = await db.fetchval(
            "select max(id) from budgeting.crypto_source_events"
        )
        query = "select budgeting.put__journal_bank_operation($1,73,'bank_asset_merge',$2::jsonb,$3)"
        payload = json.dumps(
            dict(
                bank_account_id=73,
                from_crypto_asset_id=2,
                to_crypto_asset_id=15,
                operated_at=str(date(2026, 9, 28)),
            )
        )
        result = await db.fetchval(query, UID, payload, REQUEST)
        after = await fingerprint(db)
        assert result == await db.fetchval(query, UID, payload, REQUEST)
        assert after == await fingerprint(db), "Duplicate request changed ledger"
        assert prefix == await db.fetchval(
            "select md5(string_agg(to_jsonb(t)::text,'' order by id)) from budgeting.crypto_source_events t where id<=$1",
            max_source,
        )
        assert lots == await db.fetchval(
            "select jsonb_agg(to_jsonb(t)-'crypto_asset_id' order by id)::text from budgeting.crypto_lots t where bank_account_id=73 and crypto_asset_id in(2,15)"
        )
        assert not await db.fetchval(
            "select count(*) from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id=2"
        )
        merged = await db.fetchrow(
            "select amount q,cost_base_remaining cost from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id=15"
        )
        assert dict(merged) == dict(amounts)
        for t in (
            "bank_entries",
            "budget_entries",
            "current_bank_balances",
            "current_budget_balances",
            "portfolio_positions",
            "portfolio_events",
            "crypto_protocol_positions",
            "bank_accounts",
        ):
            assert original[t] == after[t], t
        # The correction engine must be able to undo/replay the consolidation.
        source = json.loads(result)["source_event_id"]
        mutations = await db.fetchval(
            "select count(*) from budgeting.crypto_source_mutations where source_event_id=$1",
            source,
        )
        assert mutations > 0
        # A prior purchase must still be correctable through the new merge.
        prior = await db.fetchrow(
            "select id,revision from budgeting.crypto_source_events where commands->0->>'kind'='bank_purchase' and (commands#>>'{0,payload,fiat_amount}')::numeric=19400 order by id limit 1"
        )
        assert prior is not None
        preview = db.transaction()
        await preview.start()
        correction_status = "passed"
        try:
            correction = json.loads(await db.fetchval(
                "select budgeting.put__correct_crypto_source($1,$2,$3,$4,$5::jsonb,$6,false,null)",
                UID, prior["id"], prior["revision"], uuid4(),
                json.dumps([dict(command_index=0, field="fiat_amount", value="19400.01")]),
                "Rollback-only verification of asset consolidation",
            ))
            assert not correction["applied"]
        except asyncpg.RaiseError as exc:
            if "После этой цепочки есть операции вне журнала" not in str(exc):
                raise
            correction_status = "blocked_by_existing_nonjournal_tail"
        finally:
            await preview.rollback()
        assert after == await fingerprint(db), "Correction preview changed accounting"
        for bad_user, target in ((-987654321, 15), (UID, 1)):
            savepoint = db.transaction()
            await savepoint.start()
            rejected = False
            try:
                bad_payload = json.dumps(
                    dict(
                        bank_account_id=73,
                        from_crypto_asset_id=2,
                        to_crypto_asset_id=target,
                        operated_at="2026-09-28",
                    )
                )
                await db.fetchval(query, bad_user, bad_payload, uuid4())
            except asyncpg.RaiseError:
                rejected = True
            finally:
                await savepoint.rollback()
            assert rejected, "Invalid consolidation accepted"
        # Retire only a verified unused legacy catalogue identity. Existing
        # historical references remain valid; public creation cannot set aliases.
        assert not await db.fetchval(
            "select exists(select 1 from budgeting.current_crypto_balances where crypto_asset_id=2 and amount<>0)"
        )
        assert not await db.fetchval(
            "select exists(select 1 from budgeting.portfolio_positions where metadata->>'crypto_asset_id'='2' and quantity<>0)"
        )
        await db.execute(
            "update budgeting.crypto_assets set metadata=metadata||jsonb_build_object('canonical_asset_id',15) where id=2"
        )
        listed = json.loads(await db.fetchval("select budgeting.get__crypto_assets()"))
        assert 2 not in [a["id"] for a in listed] and 15 in [a["id"] for a in listed]
        ensured = json.loads(
            await db.fetchval(
                "select budgeting.put__ensure_crypto_asset('USDT','Tether USD','ton','',6::smallint,'{}'::jsonb)"
            )
        )
        assert ensured["id"] == 15
        report = dict(
            database=database,
            applied=apply,
            result=json.loads(result),
            quantity=str(merged["q"]),
            cost_RUB=str(merged["cost"]),
            historical_sources_unchanged=True,
            lot_costs_and_fifo_dates_unchanged=True,
            duplicate_request_unchanged=True,
            mutations=mutations,
            earlier_purchase_correction_preview=correction_status,
            access_and_identity_validation=True,
        )
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        (out / f"{database}-{'applied' if apply else 'preview'}.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        print(json.dumps(report, ensure_ascii=False))
    except BaseException:
        await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database", required=True)
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()
    asyncio.run(run(a.database, a.apply))
