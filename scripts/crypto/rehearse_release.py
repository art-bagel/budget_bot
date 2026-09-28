"""Replay the reviewed journal on a fixed local production snapshot, never production.

Resources and insertion identities are copied, not final quantities or costs.
All accounting is recomputed by source commands. Private evidence stays in outputs.
"""

import asyncio
import argparse
import json
import shutil
from decimal import Decimal

import asyncpg
import prepare_docker_history as prep

ROOT = prep.ROOT
DB = "crypto_release_20260928_134135"
OUT = ROOT / "outputs/crypto-update-2026-09-28/release"
WORK = OUT / "replay"


async def main(verify_only=False):
    cfg = prep.credentials()
    WORK.mkdir(exist_ok=True)
    db = await asyncpg.connect(**{**cfg, "database": DB})
    live = await asyncpg.connect(**{**cfg, "database": "budget_bot"})
    await live.execute("set default_transaction_read_only=on")
    try:
        assert await db.fetchval("select current_database()") == DB
        if verify_only:
            original = json.loads((WORK / "original.json").read_text())
            mapping = json.loads((WORK / "identity-map.json").read_text())
            transaction = db.transaction()
            await transaction.start()
            try:
                report = await verify(db, live, original, mapping)
            finally:
                await transaction.rollback()
            (WORK / "result.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(report))
            return
        assert (
            await db.fetchval("select count(*) from budgeting.crypto_source_events")
            == 0
        )
        # Save all original rows, not only the owner's old inventory subset.
        original = {}
        for table in (
            "operations",
            "bank_entries",
            "budget_entries",
            "portfolio_positions",
            "portfolio_events",
            "users",
            "categories",
            "families",
            "income_sources",
            "scheduled_expenses",
            "bank_accounts",
        ):
            original[table] = await db.fetchval(
                f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from budgeting.{table} t"
            )
        if (WORK / "original.json").exists():
            original = json.loads((WORK / "original.json").read_text())
        else:
            (WORK / "original.json").write_text(json.dumps(original))
        sources = [
            dict(r)
            for r in await live.fetch(
                "select * from budgeting.crypto_source_events order by occurred_at,order_in_timestamp"
            )
        ]
        mutations = [
            dict(r)
            for r in await live.fetch("""select m.* from budgeting.crypto_source_mutations m
            join budgeting.crypto_source_events s on s.id=m.source_event_id and s.revision=m.revision
            where m.before_row is null and m.after_row ? 'id' order by m.id""")
        ]
        assert len(sources) == 2010
        # Reviewed old crypto replacement graph. All fresh unrelated rows remain.
        shutil.copyfile(
            ROOT / "outputs/crypto-docker-migration/inventory.json",
            WORK / "inventory.json",
        )
        prep.DB, prep.OUT = DB, WORK
        prep.credentials = lambda: {**cfg, "database": DB}
        await prep.main()
        async with db.transaction():
            # Existing September server purchase will be reconstructed once with
            # its original operation identity, rather than duplicated.
            server = await db.fetchval(
                "select to_jsonb(o)::text from budgeting.operations o where id=21225"
            )
            assert server and json.loads(server)["operated_on"] == "2026-09-25"
            assert await db.fetchval(
                "select sum(amount) from budgeting.bank_entries where operation_id=21225"
            ) == Decimal("-2835")
            assert await db.fetchval(
                "select sum(amount) from budgeting.crypto_bank_entries where operation_id=21225"
            ) == Decimal("23.83")
            server_graph = {}
            for table, where in [
                ("operations", "id=21225"),
                ("bank_entries", "operation_id=21225"),
                ("crypto_bank_entries", "operation_id=21225"),
                ("crypto_lots", "opened_by_operation_id=21225"),
            ]:
                server_graph[table] = json.loads(
                    await db.fetchval(
                        f"select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text from budgeting.{table} t where {where}"
                    )
                )
            assert not await db.fetchval(
                "select count(*) from budgeting.crypto_lot_consumptions where lot_id in(select id from budgeting.crypto_lots where opened_by_operation_id=21225)"
            )
            assert not await db.fetchval(
                "select count(*) from budgeting.budget_entries where operation_id=21225"
            )
            (WORK / "matched-server.json").write_text(
                json.dumps(server_graph, ensure_ascii=False, indent=2)
            )
            for table, where in [
                ("crypto_bank_entries", "operation_id=21225"),
                ("bank_entries", "operation_id=21225"),
                ("crypto_lots", "opened_by_operation_id=21225"),
                ("operations", "id=21225"),
            ]:
                await db.execute(f"delete from budgeting.{table} where {where}")
            await db.execute("select budgeting.rebuild_current_balances($1)", prep.UID)
            # Seed only definitions: accounts and asset catalogue, never holdings.
            for table, where in [
                (
                    "bank_accounts",
                    "account_kind='investment' and investment_asset_type='crypto' and owner_user_id=478559604",
                ),
                ("crypto_assets", "true"),
            ]:
                for raw in await live.fetch(
                    f"select to_jsonb(t)::text data from budgeting.{table} t where {where} order by id"
                ):
                    row = json.loads(raw["data"])
                    old = await db.fetchval(
                        f"select to_jsonb(t)::text from budgeting.{table} t where id=$1",
                        row["id"],
                    )
                    if old:
                        if table == "crypto_assets":
                            prior = json.loads(old)
                            assert all(
                                prior[k] == row[k]
                                for k in (
                                    "symbol",
                                    "network_code",
                                    "contract_address",
                                    "decimals",
                                )
                            )
                        continue
                    if table == "bank_accounts":
                        row["is_archived"] = False
                    await db.execute(
                        f"insert into budgeting.{table} select * from jsonb_populate_record(null::budgeting.{table},$1::jsonb)",
                        json.dumps(row),
                    )
            # ID collisions from new production operations are mapped explicitly.
            mapping = {}
            for m in mutations:
                row = json.loads(m["after_row"])
                table = m["table_name"]
                ident = row["id"]
                collision = await db.fetchval(
                    f"select exists(select 1 from budgeting.{table} where id=$1)", ident
                )
                if collision or any(
                    r["id"] == ident for r in server_graph.get(table, [])
                ):
                    mapping.setdefault(table, {})[ident] = ident + 1000000
            # Keep the already existing server purchase ID and insertion time.
            server_source = next(
                s
                for s in sources
                if any(
                    c["kind"] == "bank_buy" and c["payload"].get("quantity") == "23.83"
                    for c in json.loads(s["commands"])
                )
            )
            for m in mutations:
                if (
                    m["source_event_id"] == server_source["id"]
                    and m["command_index"] == 0
                ):
                    t = m["table_name"]
                    if t in server_graph:
                        assert len(server_graph[t]) == 1
                        mapping.setdefault(t, {})[json.loads(m["after_row"])["id"]] = (
                            server_graph[t][0]["id"]
                        )
            (WORK / "identity-map.json").write_text(json.dumps(mapping, indent=2))
            await db.execute(
                "create temp table crypto_replay_identity (like budgeting.crypto_source_mutations including defaults) on commit drop"
            )
            await db.execute(
                "alter table crypto_replay_identity add column used boolean not null default false"
            )
            await db.execute(
                "create index on crypto_replay_identity(source_event_id,command_index,table_name,id) where not used"
            )
            for m in mutations:
                t = m["table_name"]
                row = json.loads(m["after_row"])
                old = row["id"]
                row["id"] = mapping.get(t, {}).get(old, old)
                if (
                    m["source_event_id"] == server_source["id"]
                    and m["command_index"] == 0
                    and t in server_graph
                    and "created_at" in server_graph[t][0]
                ):
                    row["created_at"] = server_graph[t][0]["created_at"]
                # Only identity/timestamp data is read from these slots by the
                # existing replay trigger; financial fields are not restored.
                await db.execute(
                    """insert into crypto_replay_identity(id,source_event_id,revision,command_index,table_name,row_key,after_row)
                    values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)""",
                    m["id"],
                    m["source_event_id"],
                    1,
                    m["command_index"],
                    t,
                    json.dumps({"id": row["id"]}),
                    json.dumps(row),
                )
            # Advance sequences beyond reserved identities before any new inserts.
            for table in {m["table_name"] for m in mutations} | {
                "bank_accounts",
                "crypto_assets",
            }:
                seq = await db.fetchval(
                    "select pg_get_serial_sequence($1,'id')", "budgeting." + table
                )
                if seq:
                    highest = await db.fetchval(
                        f"select coalesce(max(id),0) from budgeting.{table}"
                    )
                    ids = [
                        mapping.get(table, {}).get(
                            json.loads(m["after_row"])["id"],
                            json.loads(m["after_row"])["id"],
                        )
                        for m in mutations
                        if m["table_name"] == table
                    ]
                    await db.fetchval(
                        "select setval($1::regclass,$2,true)",
                        seq,
                        max([highest, *ids]) + 1000,
                    )
            await db.execute(
                "select set_config('budgeting.crypto_replaying','on',true)"
            )
            for n, s in enumerate(sources, 1):
                commands = json.loads(s["commands"])
                for c in commands:
                    # Most IDs stay unchanged. The only reference to a remapped
                    # ledger event in the public command contract is settlement.
                    p = c["payload"]
                    if "sale_event_id" in p:
                        p["sale_event_id"] = mapping.get("portfolio_events", {}).get(
                            p["sale_event_id"], p["sale_event_id"]
                        )
                await db.fetchval(
                    "select setval(pg_get_serial_sequence('budgeting.crypto_source_events','id'),$1,false)",
                    s["id"],
                )
                await db.fetchval(
                    "select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)",
                    s["created_by_user_id"],
                    s["anchor_account_id"],
                    s["source_namespace"],
                    s["source_id"],
                    s["occurred_at"],
                    s["order_in_timestamp"],
                    s["accounting_date"],
                    json.dumps(commands),
                    s["evidence"],
                )
                if n % 100 == 0:
                    print("Replayed", n, "/", len(sources), flush=True)
            unused = await db.fetchval(
                "select count(*) from crypto_replay_identity where not used"
            )
            assert unused == 0, ("Unused insertion identities", unused)
            await db.execute(
                "select set_config('budgeting.crypto_replaying','off',true)"
            )
            await db.fetchval(
                "select setval(pg_get_serial_sequence('budgeting.crypto_source_events','id'),(select max(id) from budgeting.crypto_source_events),true)"
            )
            # Presentation settings are ordinary account settings, not balances.
            for row in await live.fetch(
                "select id,name,is_archived,include_in_statistics,wallet_address from budgeting.bank_accounts where investment_asset_type='crypto' and owner_user_id=$1",
                prep.UID,
            ):
                await db.execute(
                    "update budgeting.bank_accounts set name=$2,is_archived=$3,include_in_statistics=$4,wallet_address=$5 where id=$1",
                    *row,
                )
            # Full verification is deliberately in the same transaction.
            report = await verify(db, live, original, mapping)
            (WORK / "result.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str)
            )
        print("Full replay committed after verification", flush=True)
    finally:
        await db.close()
        await live.close()


async def verify(db, live, original, mapping):
    from check_user_history import fingerprint

    def decode(raw):
        return json.loads(raw, parse_float=Decimal)

    preparation = decode(
        await db.fetchval(
            "select payload::text from crypto_migration_audit.preparation where id=1"
        )
    )
    replaced = set(preparation["original_operation_ids"]) | {21225}
    preserved = 0
    for table in (
        "operations",
        "bank_entries",
        "budget_entries",
        "portfolio_positions",
        "portfolio_events",
        "users",
        "categories",
        "families",
        "income_sources",
        "scheduled_expenses",
    ):
        before = decode(original[table])
        after = decode(
            await db.fetchval(
                f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from budgeting.{table} t"
            )
        )
        current = {r["id"]: r for r in after}
        for row in before:
            if table == "operations" and row["id"] in replaced:
                continue
            if (
                table in ("bank_entries", "budget_entries")
                and row["operation_id"] in replaced
            ):
                continue
            if table == "portfolio_events" and row["linked_operation_id"] in replaced:
                continue
            if table == "portfolio_positions" and row["asset_type_code"] == "crypto":
                continue
            assert current.get(row["id"]) == row, (
                "Preservation failure",
                table,
                row["id"],
            )
            preserved += 1
    assert await db.fetchval(
        "select count(*) from budgeting.operations where type='income'"
    ) == sum(r["type"] == "income" for r in decode(original["operations"]))
    # Compare economic quantities and cost components, not cosmetic metadata or dates.
    query = """select p.id,p.investment_account_id,p.metadata->>'crypto_asset_id' asset,
        p.quantity,budgeting.get__crypto_position_entry_summary(p.id)::text basis
        from budgeting.portfolio_positions p where p.asset_type_code='crypto' order by p.id"""

    def economic(rows):
        return {
            r["id"]: dict(
                account=r["investment_account_id"],
                asset=r["asset"],
                quantity=r["quantity"],
                basis={
                    k: v
                    for k, v in decode(r["basis"]).items()
                    if k
                    in (
                        "remaining_cost_basis",
                        "funding_units",
                        "has_unknown_basis",
                        "has_estimated_basis",
                    )
                },
            )
            for r in rows
        }

    expected = economic(await live.fetch(query))
    actual = economic(await db.fetch(query))
    if expected != actual:
        (WORK / "wallet-differences.json").write_text(
            json.dumps(dict(expected=expected, actual=actual), default=str, indent=2)
        )
        raise AssertionError("Wallet replay differs; inspect wallet-differences.json")
    for table in ("crypto_protocol_positions",):
        query = f"select to_jsonb(t)-'created_at'-'updated_at'-'metadata' data from budgeting.{table} t order by id"
        a = [decode(r["data"]) for r in await live.fetch(query)]
        b = [decode(r["data"]) for r in await db.fetch(query)]
        if a != b:
            (WORK / "protocol-differences.json").write_text(
                json.dumps(dict(expected=a, actual=b), default=str, indent=2)
            )
            raise AssertionError("Protocol replay differs")
    for query in (
        "select id,metadata::text metadata from budgeting.crypto_protocol_positions order by id",
        "select bank_account_id,crypto_asset_id,amount,cost_base_remaining from budgeting.current_crypto_balances order by bank_account_id,crypto_asset_id",
    ):

        def comparison(rows):
            result = []
            for raw in rows:
                row = dict(raw)
                if "metadata" in row:
                    row["metadata"] = {
                        k: v
                        for k, v in decode(row["metadata"]).items()
                        if any(
                            part in k
                            for part in (
                                "funding",
                                "basis",
                                "borrow",
                                "debt",
                                "interest",
                                "token",
                                "principal",
                                "collateral",
                            )
                        )
                    }
                result.append(row)
            return result

        assert comparison(await db.fetch(query)) == comparison(
            await live.fetch(query)
        ), query
    assert await db.fetchval(
        "select sum(amount) from budgeting.bank_entries where operation_id=21225"
    ) == Decimal("-2835")
    assert await db.fetchval(
        "select sum(amount) from budgeting.crypto_bank_entries where operation_id=21225"
    ) == Decimal("23.83")
    rub = await db.fetchval(
        "select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='RUB'"
    )
    assert rub == Decimal("76828.550712"), ("Bank RUB changed", rub)
    bank = await db.fetchval(
        "select sum(amount) from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id in (2,15)"
    )
    assert bank == Decimal("270.88168405"), bank
    assert await db.fetchval(
        "select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='USD'"
    ) == Decimal("787.18")
    # Replay the whole request stream a second time: each request must be read-only.
    before = await fingerprint(db)
    for s in await db.fetch(
        "select * from budgeting.crypto_source_events order by occurred_at,order_in_timestamp"
    ):
        result = await db.fetchval(
            "select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)",
            s["created_by_user_id"],
            s["anchor_account_id"],
            s["source_namespace"],
            s["source_id"],
            s["occurred_at"],
            s["order_in_timestamp"],
            s["accounting_date"],
            s["commands"],
            s["evidence"],
        )
        assert decode(result) == decode(s["result"]), s["id"]
    assert before == await fingerprint(db), "Repeat changed accounting"
    return dict(
        database=DB,
        sources=2010,
        preserved_rows=preserved,
        all_wallets_match=True,
        all_protocols_match=True,
        no_new_income=True,
        protocol_financing_matches=True,
        bank_crypto_cost_matches=True,
        existing_server_purchase_preserved_once=True,
        bank_RUB=str(rub),
        bank_USDT=str(bank),
        repeated_without_duplicates=True,
        production_changed=False,
        visible_dev_changed=False,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify the existing rehearsal in a rolled-back transaction",
    )
    asyncio.run(main(parser.parse_args().verify_only))
