"""Replay the accepted review journal on a fresh local production snapshot, never production.

Only insertion identities, account/asset definitions and presentation settings
are copied. Every quantity, cost and budget amount is recomputed by the journal
commands. The previous single-snapshot version is kept in git at 0bd9965.
Private evidence stays in outputs/.
"""

import argparse
import asyncio
import hashlib
import json
import shutil
import subprocess
from decimal import Decimal

import asyncpg
import prepare_docker_history as prep
from check_user_history import fingerprint

ROOT = prep.ROOT
DB = "crypto_release_20260929"
# Untouched restore of the fresh production dump; compared, never modified.
SNAPSHOT = "crypto_prod_20260928_211943"
# The copy the owner reviewed and edited through the ordinary interface, and
# the production copy it was built on. Production rows absent from BASE are
# production-only and must appear in the candidate exactly once.
JOURNAL = "crypto_review_20260928"
JOURNAL_DIGEST = "2841bf76b91b573e84abbc9731d9e2ac"  # frozen review journal, 2035 sources
BASE = "crypto_prod_20260928_134135"
OUT = ROOT / "outputs/crypto-release-2026-09-29/replay"
SERVER = 21225
# Review sources that must not reach production, decided by meaning.
EXCLUDED = {
    2233: "trial 22.36 RUB entry, reversed outside the journal by 1023400; the real payment is 2234 in USD",
    2290: "«Браслет для часов» 709 RUB already exists in production as operation 21274",
}
EXCLUDED_NONJOURNAL = {1023400: "reversal of the trial operation 1023399 (source 2233)"}
# The linked-FX repair runs as journal request 2289, exactly as in review.
# Earlier sources were recorded before 304bed1; replaying them with the repaired
# settlement would change their stored posting structure, which the identity
# guard rejects. So they replay with the function version that produced them.
REPAIR_SOURCE = 2289
PRE_REPAIR = "304bed1^"
SETTLE = "infra/db/Scripts/budgeting/func/put__settle_crypto_fiat_sale.sql"
PRESERVED_EXCEPTIONS = ("current_bank_balances", "current_budget_balances", "current_crypto_balances",
                        "schema_migrations", "sessions")


def decode(raw):
    return json.loads(raw, parse_float=Decimal)


async def rows(db, table, where="true", *args):
    return decode(await db.fetchval(
        f"select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text from budgeting.{table} t where {where}", *args))


async def tables(db):
    return [r["t"] for r in await db.fetch(
        "select table_name t from information_schema.tables where table_schema='budgeting' and table_type='BASE TABLE' order by 1")]


async def functions(db):
    return {r["f"]: r["d"] for r in await db.fetch(
        """select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' f,
        md5(p.prosrc||coalesce(array_to_string(p.proconfig,','),'')) d from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='budgeting'""")}


async def main(verify_only=False):
    cfg = prep.credentials()
    OUT.mkdir(parents=True, exist_ok=True)
    db = await asyncpg.connect(**{**cfg, "database": DB})
    journal = await asyncpg.connect(**{**cfg, "database": JOURNAL})
    snapshot = await asyncpg.connect(**{**cfg, "database": SNAPSHOT})
    base = await asyncpg.connect(**{**cfg, "database": BASE})
    for ro in (journal, snapshot, base):
        await ro.execute("set default_transaction_read_only=on")
    try:
        assert cfg["host"] == "127.0.0.1" and DB.startswith("crypto_release_") and SNAPSHOT.startswith("crypto_prod_")
        assert await db.fetchval("select current_database()") == DB
        assert await db.fetchval("select count(*) from budgeting.schema_migrations where filename='049_archive_import_accounts.sql'") == 1
        sources, excluded = await portable_sources(journal, snapshot)
        if verify_only:
            original = decode((OUT / "original.json").read_text())
            mapping = decode((OUT / "identity-map.json").read_text())
            tx = db.transaction()
            await tx.start()
            try:
                report = await verify(db, journal, snapshot, base, original, mapping, sources)
            finally:
                await tx.rollback()
            (OUT / "result-verify-only.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
            print(json.dumps(report, ensure_ascii=False, default=str))
            return
        assert await db.fetchval("select to_regclass('budgeting.crypto_source_events') is not null")
        assert await db.fetchval("select count(*) from budgeting.crypto_source_events") == 0
        # All pre-transfer rows of every table, captured once before preparation.
        if (OUT / "original.json").exists():
            original = decode((OUT / "original.json").read_text())
            assert original["_database"] == DB
        else:
            # Keep PostgreSQL's own JSON text so numerics round-trip exactly.
            parts = [f'"_database":{json.dumps(DB)}']
            for table in await tables(db):
                raw = await db.fetchval(f"select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text from budgeting.{table} t")
                parts.append(f"{json.dumps(table)}:{raw}")
            text = "{" + ",".join(parts) + "}"
            (OUT / "original.json").write_text(text)
            original = decode(text)
        (OUT / "portable-set.json").write_text(json.dumps(dict(
            journal=JOURNAL, total=len(sources) + len(excluded), portable=len(sources),
            excluded=excluded, excluded_nonjournal=EXCLUDED_NONJOURNAL,
            first=sources[0]["id"], last=sources[-1]["id"],
            after_history=[dict(id=s["id"], kinds=[c["kind"] for c in decode(s["commands"])]) for s in sources if s["id"] > 2218],
        ), ensure_ascii=False, indent=2, default=str))
        mutations = [dict(r) for r in await journal.fetch(
            """select m.* from budgeting.crypto_source_mutations m
            join budgeting.crypto_source_events s on s.id=m.source_event_id and s.revision=m.revision
            where m.before_row is null and m.after_row ? 'id' and not (s.id=any($1::bigint[])) order by m.id""",
            list(EXCLUDED))]
        # Reviewed old crypto graph that the journal replaces. Fresh unrelated rows remain.
        shutil.copyfile(ROOT / "outputs/crypto-docker-migration/inventory.json", OUT / "inventory.json")
        prep.DB, prep.OUT = DB, OUT
        prep.credentials = lambda: {**cfg, "database": DB}
        await prep.main()
        pre_repair = await asyncio.to_thread(
            subprocess.check_output, ["git", "-C", str(ROOT), "show", f"{PRE_REPAIR}:{SETTLE}"], text=True)
        (OUT / "pre-repair-settle.sql").write_text(pre_repair)
        async with db.transaction():
            code_before = await functions(db)
            server_graph = await match_server(db)
            await seed_definitions(db, journal)
            mapping = await identities(db, mutations, server_graph)
            (OUT / "identity-map.json").write_text(json.dumps(mapping, indent=2))
            await db.execute("select set_config('budgeting.crypto_replaying','on',true)")
            await db.execute(pre_repair)
            for n, s in enumerate(sources, 1):
                commands = decode(s["commands"])
                for c in commands:
                    # The only ledger identity in the public command contract.
                    p = c["payload"]
                    if "sale_event_id" in p:
                        p["sale_event_id"] = mapping.get("portfolio_events", {}).get(str(p["sale_event_id"]), p["sale_event_id"])
                if s["id"] == REPAIR_SOURCE:
                    await db.execute((ROOT / SETTLE).read_text())
                await db.fetchval(
                    "select setval(pg_get_serial_sequence('budgeting.crypto_source_events','id'),$1,false)", s["id"])
                await db.fetchval(
                    "select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)",
                    s["created_by_user_id"], s["anchor_account_id"], s["source_namespace"], s["source_id"],
                    s["occurred_at"], s["order_in_timestamp"], s["accounting_date"],
                    json.dumps(commands, default=str), s["evidence"])
                if n % 250 == 0:
                    print("Replayed", n, "/", len(sources), flush=True)
            assert await db.fetchval("select count(*) from crypto_replay_identity where not used") == 0, "Unused insertion identities"
            await db.execute("select set_config('budgeting.crypto_replaying','off',true)")
            await db.fetchval(
                "select setval(pg_get_serial_sequence('budgeting.crypto_source_events','id'),(select max(id) from budgeting.crypto_source_events),true)")
            code_after = await functions(db)
            assert code_after == code_before, ("Replay must end on the branch SQL functions",
                                               sorted(k for k in set(code_before) | set(code_after) if code_before.get(k) != code_after.get(k)))
            # Presentation settings are ordinary account settings, not balances.
            # Accounts that already exist in production keep their production
            # names (owner's decision 29.09); new accounts take the review names.
            for row in await journal.fetch(
                "select id,name,is_archived,include_in_statistics,wallet_address from budgeting.bank_accounts where investment_asset_type='crypto' and owner_user_id=$1",
                prep.UID,
            ):
                await db.execute(
                    """update budgeting.bank_accounts set name=case when id=any($6::bigint[]) then name else $2 end,
                    is_archived=$3,include_in_statistics=$4,wallet_address=$5 where id=$1""",
                    *row, [a["id"] for a in original["bank_accounts"]])
            # Catalogue alias set outside the journal in review by merge_usdt_dev.py.
            assert not await db.fetchval(
                "select exists(select 1 from budgeting.current_crypto_balances where crypto_asset_id=2 and amount<>0)")
            assert not await db.fetchval(
                "select exists(select 1 from budgeting.portfolio_positions where metadata->>'crypto_asset_id'='2' and quantity<>0)")
            await db.execute(
                "update budgeting.crypto_assets set metadata=metadata||jsonb_build_object('canonical_asset_id',15) where id=2")
            report = await verify(db, journal, snapshot, base, original, mapping, sources)
            (OUT / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        print("Full replay committed after verification", flush=True)
    finally:
        for c in (db, journal, snapshot, base):
            await c.close()


async def portable_sources(journal, snapshot):
    """Review journal minus explicit non-portable entries, each checked by meaning."""
    trial = decode(await journal.fetchval("select commands::text from budgeting.crypto_source_events where id=2233"))
    assert trial[0]["kind"] == "bank_expense" and trial[0]["payload"]["currency_code"] == "RUB"
    assert Decimal(trial[0]["payload"]["amount"]) == Decimal("22.36")
    assert await journal.fetchval(
        "select reversal_of_operation_id from budgeting.operations where id=1023400") == 1023399
    assert await journal.fetchval(
        "select count(*) from budgeting.crypto_source_mutations where source_event_id=2233 and table_name='operations' and (after_row->>'id')::bigint=1023399") == 1
    duplicate = decode(await journal.fetchval("select commands::text from budgeting.crypto_source_events where id=2290"))[0]
    production = await snapshot.fetchrow(
        """select o.comment,o.operated_on::text op_day,b.amount bank,b.currency_code,b.bank_account_id,e.category_id,e.amount budget
        from budgeting.operations o join budgeting.bank_entries b on b.operation_id=o.id
        join budgeting.budget_entries e on e.operation_id=o.id where o.id=21274""")
    assert duplicate["kind"] == "bank_expense" and duplicate["payload"]["comment"] == production["comment"] == "Браслет для часов"
    assert Decimal(duplicate["payload"]["amount"]) == -production["bank"] == -production["budget"] == Decimal("709")
    assert (duplicate["payload"]["operated_at"], duplicate["payload"]["category_id"], duplicate["payload"]["bank_account_id"]) == (
        production["op_day"], production["category_id"], production["bank_account_id"])
    # Nothing else in review changed accounting outside the journal and the
    # original preparation (19911 reversal and its replacement expense).
    outside = await journal.fetch(
        """select o.id,o.type,o.reversal_of_operation_id,o.comment from budgeting.operations o
        where not exists(select 1 from budgeting.crypto_source_mutations m where m.table_name='operations' and (m.after_row->>'id')::bigint=o.id)
        and o.created_at>'2026-09-28 13:41:35+00' order by o.id""")
    assert [r["id"] for r in outside if r["reversal_of_operation_id"] != 19911
            and r["comment"] != "Неучтённые расходы: остаток после восстановления криптопокупок (замена 19911)"] == list(EXCLUDED_NONJOURNAL)
    assert not await journal.fetchval(
        "select count(*) from budgeting.crypto_source_events where revision<>1 or id in (select source_event_id from budgeting.crypto_source_corrections)")
    assert await journal.fetchval("""select md5(string_agg(id::text||':'||revision||':'||commands::text||':'||evidence::text,E'\n' order by id))
        from budgeting.crypto_source_events""") == JOURNAL_DIGEST, "Review journal changed after the accepted rehearsal"
    sources = [dict(r) for r in await journal.fetch(
        "select * from budgeting.crypto_source_events where not (id=any($1::bigint[])) order by occurred_at,order_in_timestamp",
        list(EXCLUDED))]
    assert await journal.fetchval("select count(*) from budgeting.crypto_source_events") == len(sources) + len(EXCLUDED)
    return sources, EXCLUDED


async def match_server(db):
    """The September server purchase exists in production; the journal rebuilds it once."""
    graph = {}
    for table, where in [("operations", "id=$1"), ("bank_entries", "operation_id=$1"),
                         ("crypto_bank_entries", "operation_id=$1"), ("crypto_lots", "opened_by_operation_id=$1")]:
        graph[table] = await rows(db, table, where, SERVER)
        assert len(graph[table]) == 1, table
    assert graph["operations"][0]["operated_on"] == "2026-09-25"
    assert graph["bank_entries"][0]["amount"] == Decimal("-2835")
    assert graph["crypto_bank_entries"][0]["amount"] == Decimal("23.83")
    assert not await db.fetchval(
        "select count(*) from budgeting.crypto_lot_consumptions where lot_id in(select id from budgeting.crypto_lots where opened_by_operation_id=$1)", SERVER)
    assert not await db.fetchval("select count(*) from budgeting.budget_entries where operation_id=$1", SERVER)
    (OUT / "matched-server.json").write_text(json.dumps(graph, ensure_ascii=False, indent=2, default=str))
    for table, where in [("crypto_bank_entries", "operation_id=$1"), ("bank_entries", "operation_id=$1"),
                         ("crypto_lots", "opened_by_operation_id=$1"), ("operations", "id=$1")]:
        await db.execute(f"delete from budgeting.{table} where {where}", SERVER)
    await db.execute("select budgeting.rebuild_current_balances($1)", prep.UID)
    return graph


async def seed_definitions(db, journal):
    """Accounts and asset catalogue only, never holdings."""
    for table, where in [
        ("bank_accounts", "account_kind='investment' and investment_asset_type='crypto' and owner_user_id=478559604"),
        ("crypto_assets", "true"),
    ]:
        for raw in await journal.fetch(f"select to_jsonb(t)::text data from budgeting.{table} t where {where} order by id"):
            row = json.loads(raw["data"])
            old = await db.fetchval(f"select to_jsonb(t)::text from budgeting.{table} t where id=$1", row["id"])
            if old:
                prior = json.loads(old)
                keys = ("symbol", "network_code", "contract_address", "decimals") if table == "crypto_assets" else (
                    "owner_type", "owner_user_id", "account_kind", "investment_asset_type")
                assert all(prior[k] == row[k] for k in keys), (table, row["id"])
                continue
            if table == "bank_accounts":
                row["is_archived"] = False
            await db.execute(
                f"insert into budgeting.{table} select * from jsonb_populate_record(null::budgeting.{table},$1::jsonb)", json.dumps(row))


async def identities(db, mutations, server_graph):
    """Reuse review identities; move only those taken by fresh production rows."""
    server_ids = {t: {r["id"] for r in rs} for t, rs in server_graph.items()}
    reserved = {}
    for m in mutations:
        reserved.setdefault(m["table_name"], set()).add(json.loads(m["after_row"])["id"])
    mapping = {}
    for m in mutations:
        row = json.loads(m["after_row"])
        table, ident = m["table_name"], row["id"]
        if ident in server_ids.get(table, ()):
            continue  # the server purchase keeps its production identity
        if await db.fetchval(f"select exists(select 1 from budgeting.{table} where id=$1)", ident):
            target = ident + 2000000
            assert target not in reserved[table]
            assert not await db.fetchval(f"select exists(select 1 from budgeting.{table} where id=$1)", target)
            mapping.setdefault(table, {})[str(ident)] = target
    for table, ids in server_ids.items():
        # Review already carries the production identities for the server purchase.
        assert ids <= reserved.get(table, set()), table
    await db.execute(
        "create temp table crypto_replay_identity (like budgeting.crypto_source_mutations including defaults) on commit drop")
    await db.execute("alter table crypto_replay_identity add column used boolean not null default false")
    await db.execute("create index on crypto_replay_identity(source_event_id,command_index,table_name,id) where not used")
    for m in mutations:
        row = json.loads(m["after_row"])
        row["id"] = mapping.get(m["table_name"], {}).get(str(row["id"]), row["id"])
        # Only identity/timestamp data is read from these slots by the replay trigger.
        await db.execute(
            """insert into crypto_replay_identity(id,source_event_id,revision,command_index,table_name,row_key,after_row)
            values($1,$2,1,$3,$4,$5::jsonb,$6::jsonb)""",
            m["id"], m["source_event_id"], m["command_index"], m["table_name"], json.dumps({"id": row["id"]}), json.dumps(row))
    # Advance sequences beyond reserved identities and seeded definitions before any new inserts.
    for table, ids in {**reserved, "bank_accounts": set(), "crypto_assets": set()}.items():
        seq = await db.fetchval("select pg_get_serial_sequence($1,'id')", "budgeting." + table)
        if seq:
            highest = await db.fetchval(f"select coalesce(max(id),0) from budgeting.{table}")
            moved = mapping.get(table, {}).values()
            await db.fetchval("select setval($1::regclass,$2,true)", seq, max([highest, *ids, *moved]) + 1000)
    return mapping


async def effects(conn, ops):
    """Net bank and budget postings of the given operations."""
    return [{(r[0], r[1]): r[2] for r in await conn.fetch(
        f"select {key},currency_code,sum(amount) from budgeting.{table} where operation_id=any($1::bigint[]) group by 1,2", ops)}
        for table, key in (("bank_entries", "bank_account_id"), ("budget_entries", "category_id"))]


async def verify(db, journal, snapshot, base, original, mapping, sources):
    def moved(table, ident):
        return mapping.get(table, {}).get(str(ident), ident)

    preparation = decode(await db.fetchval("select payload::text from crypto_migration_audit.preparation where id=1"))
    replaced = set(preparation["original_operation_ids"]) | {SERVER}
    # 1. Every pre-transfer row outside the agreed replacement graph is unchanged.
    preserved, changed = 0, {}
    for table in await tables(db):
        if table not in original or table in PRESERVED_EXCEPTIONS or table.startswith("crypto_source"):
            continue
        current = {json.dumps(r.get("id", r), sort_keys=True, default=str): r for r in await rows(db, table)}
        for row in original[table]:
            if table == "operations" and row["id"] in replaced:
                continue
            if row.get("operation_id") in replaced or row.get("linked_operation_id") in replaced or row.get("opened_by_operation_id") in replaced:
                continue
            if table == "portfolio_positions" and row["asset_type_code"] == "crypto":
                continue
            after = current.get(json.dumps(row.get("id", row), sort_keys=True, default=str))
            if after == row:
                preserved += 1
            else:
                changed.setdefault(table, []).append(dict(before=row, after=after))
    (OUT / "preservation-changes.json").write_text(json.dumps(changed, ensure_ascii=False, indent=1, default=str))
    # Allowed: settings of the owner's crypto accounts and the USD lots that
    # replayed card payments consume. Everything else must be byte-identical.
    for row in changed.pop("bank_accounts", []):
        assert row["after"] and row["before"]["investment_asset_type"] == "crypto" and row["before"]["owner_user_id"] == prep.UID, row
        assert {k for k in row["before"] if row["before"][k] != row["after"][k]} <= {"is_archived", "include_in_statistics", "wallet_address"}, row
    for row in changed.pop("crypto_assets", []):
        assert row["before"]["id"] == 2 and row["after"]["metadata"] == {"canonical_asset_id": 15}, row
    for row in changed.pop("fx_lots", []):
        assert row["after"] and row["before"]["bank_account_id"] == 73
        assert {k for k in row["before"] if row["before"][k] != row["after"][k]} <= {"amount_remaining", "cost_base_remaining"}, row
    assert not changed, ("Preservation failure", {t: len(v) for t, v in changed.items()})
    # 2. Every production operation, including those after the review copy, exactly once.
    production_ops = {r["id"] for r in await snapshot.fetch("select id from budgeting.operations")}
    candidate_ops = {r["id"] for r in await db.fetch("select id from budgeting.operations")}
    assert production_ops - replaced <= candidate_ops
    signature = """select o.id,o.type,o.operated_on,o.comment,
        (select jsonb_agg(jsonb_build_array(bank_account_id,currency_code,amount) order by bank_account_id,currency_code,amount) from budgeting.bank_entries where operation_id=o.id) bank,
        (select jsonb_agg(jsonb_build_array(category_id,amount) order by category_id,amount) from budgeting.budget_entries where operation_id=o.id) budget
        from budgeting.operations o"""
    base_ops = {r["id"] for r in await base.fetch("select id from budgeting.operations")}
    assert base_ops <= production_ops, "Production lost operations after the review base"
    production_only = sorted(production_ops - base_ops)
    for op in production_only:
        same = await db.fetchval(f"select count(*) from ({signature}) a join ({signature} where o.id=$1) b on a.type=b.type and a.operated_on=b.operated_on and a.comment is not distinct from b.comment and a.bank is not distinct from b.bank and a.budget is not distinct from b.budget", op)
        assert same == 1, ("Production operation not exactly once", op, same)
    assert not await db.fetchval(
        "select count(*) from budgeting.operations o join budgeting.bank_entries b on b.operation_id=o.id where o.comment='Браслет для часов' and o.id<>21274")
    assert 21274 in production_only
    income = [r["id"] for r in await db.fetch("select id from budgeting.operations where type='income' order by id")]
    assert income == sorted(r["id"] for r in original["operations"] if r["type"] == "income"), "New income"
    assert await db.fetchval("select sum(amount) from budgeting.bank_entries where operation_id=$1", SERVER) == Decimal("-2835")
    assert await db.fetchval("select sum(amount) from budgeting.crypto_bank_entries where operation_id=$1", SERVER) == Decimal("23.83")
    # 3. Crypto state equals the accepted review: wallets, DeFi, bank crypto, lots.
    query = """select p.id,p.investment_account_id,p.metadata->>'crypto_asset_id' asset,p.quantity,p.status,
        budgeting.get__crypto_position_entry_summary(p.id)::text basis
        from budgeting.portfolio_positions p where p.asset_type_code='crypto' order by p.id"""

    def economic(rs, remap):
        return {remap("portfolio_positions", r["id"]): dict(
            account=r["investment_account_id"], asset=r["asset"], quantity=r["quantity"], status=r["status"],
            basis={k: v for k, v in decode(r["basis"]).items() if k in (
                "remaining_cost_basis", "funding_units", "has_unknown_basis", "has_estimated_basis")}) for r in rs}

    expected = economic(await journal.fetch(query), moved)
    actual = economic(await db.fetch(query), lambda t, i: i)
    if expected != actual:
        (OUT / "wallet-differences.json").write_text(json.dumps(dict(expected=expected, actual=actual), default=str, indent=2))
        raise AssertionError("Wallets differ from review")
    comparisons = {
        "crypto_protocol_positions": "select to_jsonb(t)-'created_at'-'updated_at' d from budgeting.crypto_protocol_positions t order by id",
        "current_crypto_balances": "select to_jsonb(t)-'updated_at' d from budgeting.current_crypto_balances t order by bank_account_id,crypto_asset_id",
        "crypto_lots": "select to_jsonb(t) d from budgeting.crypto_lots t order by id",
        "crypto_lot_consumptions": "select to_jsonb(t) d from budgeting.crypto_lot_consumptions t order by id",
        "fx_lots": "select to_jsonb(t) d from budgeting.fx_lots t where bank_account_id=73 order by id",
        "portfolio_events": "select to_jsonb(t) d from budgeting.portfolio_events t where position_id in (select id from budgeting.portfolio_positions where asset_type_code='crypto') order by id",
    }
    refs = {"operation_id": "operations", "opened_by_operation_id": "operations", "linked_operation_id": "operations",
            "lot_id": "crypto_lots", "position_id": "portfolio_positions"}  # only crypto tables are compared here
    for table, q in comparisons.items():
        def norm(r, remap, table=table):
            r = decode(r["d"])
            if "id" in r:
                r["id"] = remap(table, r["id"])
            for k, t in refs.items():
                if r.get(k) is not None:
                    r[k] = remap(t, r[k])
            return r
        a = sorted((norm(r, moved) for r in await journal.fetch(q)), key=lambda r: json.dumps(r, sort_keys=True, default=str))
        b = sorted((norm(r, lambda t, i: i) for r in await db.fetch(q)), key=lambda r: json.dumps(r, sort_keys=True, default=str))
        if a != b:
            (OUT / f"{table}-differences.json").write_text(json.dumps(dict(review=a, candidate=b), default=str, indent=1))
            raise AssertionError(f"{table} differs from review")
    # 4. Expense costs of every replayed USD card payment equal review after its repair.
    q = """select c.operation_id op,sum(c.amount) qty,sum(c.cost_base) cost from budgeting.lot_consumptions c
        join budgeting.fx_lots f on f.id=c.lot_id where f.bank_account_id=73 and f.currency_code='USD' group by 1"""
    review_costs = {moved("operations", r["op"]): (r["qty"], r["cost"]) for r in await journal.fetch(q)}
    review_costs.pop(1023399, None)
    assert review_costs == {r["op"]: (r["qty"], r["cost"]) for r in await db.fetch(q)}, "USD expense costs differ from review"
    # 5. Bank and budget balances: review minus excluded review entries plus
    # production-only operations, nothing else.
    excluded_ops = [r[0] for r in await journal.fetch(
        """select distinct (after_row->>'id')::bigint from budgeting.crypto_source_mutations
        where table_name='operations' and before_row is null and source_event_id=any($1::bigint[])""", list(EXCLUDED))]
    excluded_ops += list(EXCLUDED_NONJOURNAL)
    added_bank, added_budget = await effects(snapshot, production_only)
    removed_bank, removed_budget = await effects(journal, excluded_ops)

    def expected(review, added, removed):
        keys = set(review) | set(added) | set(removed)
        return {k: review.get(k, 0) + added.get(k, 0) - removed.get(k, 0) for k in keys}

    def same(expect, actual):
        return [(k, expect.get(k), actual.get(k)) for k in set(expect) | set(actual) if expect.get(k, 0) != actual.get(k, 0)]

    bank = "select bank_account_id,currency_code,amount,historical_cost_in_base from budgeting.current_bank_balances"
    review_bank = {(r[0], r[1]): (r[2], r[3]) for r in await journal.fetch(bank)}
    candidate_bank = {(r[0], r[1]): (r[2], r[3]) for r in await db.fetch(bank)}
    delta = expected({}, added_bank, removed_bank)
    assert not same(expected({k: v[0] for k, v in review_bank.items()}, added_bank, removed_bank),
                    {k: v[0] for k, v in candidate_bank.items()}), "Bank balances differ from review"
    for key, (_amount, cost) in candidate_bank.items():
        change = delta.get(key, 0)
        assert change == 0 or key[1] == "RUB", ("Production-only foreign currency posting needs a manual check", key)
        assert cost == review_bank.get(key, (0, 0))[1] + round(change, 2), ("Bank cost differs from review", key)
    budget = "select category_id,currency_code,amount from budgeting.current_budget_balances"
    review_budget = {(r[0], r[1]): r[2] for r in await journal.fetch(budget)}
    candidate_budget = {(r[0], r[1]): r[2] for r in await db.fetch(budget)}
    assert not same(expected(review_budget, added_budget, removed_budget), candidate_budget), "Budget differs from review"
    # 6. Linked payments consume their own sale lot; FX lots equal balances.
    assert await db.fetchval("""select count(*) from budgeting.portfolio_events e where e.metadata->>'action'='fiat_sell'
        and e.metadata->>'target_bank_account_id'='73' and e.currency_code='USD' and e.metadata ? 'manual_expense_settlement'
        and (select coalesce(sum(c.amount),0) from budgeting.lot_consumptions c
             where c.operation_id=(e.metadata#>>'{manual_expense_settlement,result,operation_id}')::bigint
             and c.lot_id=(e.metadata->>'fx_lot_id')::bigint)<>e.amount""") == 0
    assert await db.fetchval("select count(*) from budgeting.fx_lots where amount_remaining<0 or cost_base_remaining<0") == 0
    assert await db.fetchval("select count(*) from budgeting.crypto_lots where amount_remaining<0 or cost_base_remaining<0") == 0
    assert not await db.fetchval("""select count(*) from budgeting.current_bank_balances b
        join lateral (select count(*) n,sum(amount_remaining) q,sum(cost_base_remaining) c from budgeting.fx_lots f
        where f.bank_account_id=b.bank_account_id and f.currency_code=b.currency_code) l on l.n>0
        where b.currency_code<>'RUB' and (b.amount<>l.q or b.historical_cost_in_base<>l.c)""")
    # 7. Every identity sequence is ahead of its table, so ordinary inserts work after the release.
    for r in await db.fetch("""select c.relname t,pg_get_serial_sequence('budgeting.'||c.relname,'id') s from pg_class c
        join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='id'
        where n.nspname='budgeting' and c.relkind='r'"""):
        if r["s"]:
            assert await db.fetchval(f"select coalesce(max(id),0) from budgeting.{r['t']}") <= await db.fetchval(
                f"select last_value from {r['s']}"), ("Sequence behind table", r["t"])
    # 8. Repeat every request and the ordinary gift settlement: both read-only.
    before = await fingerprint(db)
    for s in await db.fetch("select * from budgeting.crypto_source_events order by occurred_at,order_in_timestamp"):
        result = await db.fetchval(
            "select budgeting.put__crypto_source_event($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)",
            s["created_by_user_id"], s["anchor_account_id"], s["source_namespace"], s["source_id"],
            s["occurred_at"], s["order_in_timestamp"], s["accounting_date"], s["commands"], s["evidence"])
        assert decode(result) == decode(s["result"]), s["id"]
    await db.fetchval("select budgeting.put__settle_crypto_fiat_sale($1,97,$2,102,'Подарок Сергею','2026-05-03')",
                      prep.UID, moved("portfolio_events", 16864))
    assert before == await fingerprint(db), "Repeat changed accounting"
    free = await db.fetchval("select sum(amount) from budgeting.current_budget_balances where category_id in (88,89)")
    return dict(
        database=DB, snapshot=SNAPSHOT, journal=JOURNAL, base=BASE, sources=len(sources), excluded=EXCLUDED,
        production_only_operations=production_only,
        preserved_rows=preserved, remapped={t: len(v) for t, v in mapping.items()},
        crypto_state_equals_review=True, usd_expense_costs_equal_review=True, bank_balances_equal_review=True,
        budget_equals_review_plus_production_only=True, no_new_income=True,
        existing_server_purchase_preserved_once=True, linked_payments_use_own_lot=True,
        repeated_without_changes=True, production_changed=False,
        bank_RUB=await db.fetchval("select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='RUB'"),
        bank_USD=await db.fetchval("select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='USD'"),
        bank_USDT=await db.fetchval("select sum(amount) from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id in (2,15)"),
        unaccounted_RUB=await db.fetchval("select amount from budgeting.current_budget_balances where category_id=90"),
        free_with_fx_RUB=free,
        gifts_RUB=await db.fetchval("select amount from budgeting.current_budget_balances where category_id=102"),
        fingerprint=hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Verify the existing rehearsal in a rolled-back transaction")
    parser.add_argument("--database", default=DB, help="Local candidate database (crypto_release_*)")
    parser.add_argument("--snapshot", default=SNAPSHOT, help="Untouched local restore of the production dump (crypto_prod_*)")
    parser.add_argument("--out", default=str(OUT), help="Private evidence directory under outputs/")
    args = parser.parse_args()
    DB, SNAPSHOT, OUT = args.database, args.snapshot, type(ROOT)(args.out)
    asyncio.run(main(args.verify_only))
