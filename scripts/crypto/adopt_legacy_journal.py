"""Adopt verified legacy snapshots on an isolated dev clone before publication.

Fixed local databases; no production access. Original financial rows are restored
byte-for-byte after proving equivalent reconstruction; only audit/source links
are added. Artifacts stay under ignored outputs/crypto-legacy-adoption.
"""

import asyncio
import argparse
import json
import subprocess
from decimal import Decimal

import asyncpg

from prepare_docker_history import ROOT, credentials
from rebuild_history_snapshots import function_paths, normalized
from check_user_history import TABLES

DB = "crypto_legacy_acceptance"
OUT = ROOT / "outputs/crypto-legacy-adoption"
FINANCIAL = tuple(
    t for t in TABLES if t not in ("crypto_source_events", "crypto_source_event_links")
) + ("crypto_liability_events", "crypto_protocol_accrual_events", "categories")


def decode(value):
    return json.loads(value, parse_float=Decimal) if value is not None else None


def same(a, b):
    return decode(a) == decode(b)


async def rows(db, table):
    return {
        r["key"]: r["row"]
        for r in await db.fetch(f"""select
        (select jsonb_object_agg(a.attname,to_jsonb(t)->a.attname)::text
         from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
         where i.indrelid='budgeting.{table}'::regclass and i.indisprimary) key,
        to_jsonb(t)::text row from budgeting.{table} t""")
    }


async def putrow(db, table, raw):
    # Table names come only from the reviewed schema, never user-provided input.
    cols = await db.fetchval(
        "select string_agg(quote_ident(attname)||'=x.'||quote_ident(attname),',') from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",
        "budgeting." + table,
    )
    pk = await db.fetchval(
        "select string_agg('t.'||quote_ident(a.attname)||'=x.'||quote_ident(a.attname),' AND ') from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary",
        "budgeting." + table,
    )
    result = await db.execute(
        f"UPDATE budgeting.{table} t SET {cols} FROM jsonb_populate_record(NULL::budgeting.{table},$1::jsonb) x WHERE {pk}",
        raw,
    )
    if result == "UPDATE 0":
        await db.execute(
            f"INSERT INTO budgeting.{table} SELECT * FROM jsonb_populate_record(NULL::budgeting.{table},$1::jsonb)",
            raw,
        )


async def setup():
    cfg = credentials()
    admin = await asyncpg.connect(**{**cfg, "database": "postgres"})
    try:
        if await admin.fetchval(
            "select exists(select 1 from pg_database where datname=$1)", DB
        ):
            raise RuntimeError("Acceptance clone exists; will not replace it")
        OUT.mkdir(parents=True, exist_ok=True)
        backup = OUT / "visible-dev-before.dump"
        if backup.exists():
            raise RuntimeError("Backup already exists; do not overwrite")
        with backup.open("wb") as stream:
            await asyncio.to_thread(
                subprocess.run,
                [
                    "docker",
                    "exec",
                    "budget_bot_db",
                    "pg_dump",
                    "-U",
                    cfg["user"],
                    "-Fc",
                    "budget_bot",
                ],
                stdout=stream,
                check=True,
            )
        await admin.execute(f"CREATE DATABASE {DB}")
        with backup.open("rb") as stream:
            await asyncio.to_thread(
                subprocess.run,
                [
                    "docker",
                    "exec",
                    "-i",
                    "budget_bot_db",
                    "pg_restore",
                    "-U",
                    cfg["user"],
                    "--exit-on-error",
                    "-d",
                    DB,
                ],
                stdin=stream,
                check=True,
            )
    finally:
        await admin.close()


async def adopt():
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = credentials()
    db = await asyncpg.connect(**{**cfg, "database": DB})
    fresh = await asyncpg.connect(**{**cfg, "database": "crypto_revision_preview"})
    try:
        async with db.transaction():
            for path in function_paths():
                await db.execute(path.read_text())
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.crypto_source_mutations"
                )
                == 0
            )
            original = {t: await rows(db, t) for t in FINANCIAL}
            old_sources = await rows(db, "crypto_source_events")
            new_sources = await rows(fresh, "crypto_source_events")
            assert len(old_sources) == len(new_sources) == 1960
            times = {}
            for key, raw in old_sources.items():
                a, b = decode(raw), decode(new_sources[key])
                for value in (a, b):
                    value.pop("reversible")
                    value.pop("created_at")
                    value["result"] = normalized(value["result"])
                assert a == b, ("source", key)
                times[decode(new_sources[key])["created_at"]] = decode(raw)[
                    "created_at"
                ]
            # Created timestamps are immutable FIFO identities. Obtain preparation
            # timestamps from matched original rows as well as source timestamps.
            for table in FINANCIAL:
                rebuilt = await rows(fresh, table)
                for key in original[table].keys() & rebuilt.keys():
                    a, b = decode(original[table][key]), decode(rebuilt[key])
                    if "created_at" in a:
                        source = b["created_at"]
                        target = a["created_at"]
                        assert source not in times or times[source] == target, (
                            "ambiguous timestamp",
                            table,
                            key,
                        )
                        times[source] = target
            mutations = [
                dict(r)
                for r in await fresh.fetch(
                    "select * from budgeting.crypto_source_mutations order by id"
                )
            ]
            # Normalize JSON with SQL to retain every numeric digit.
            await db.execute(
                "create temp table adopted_mutations (like budgeting.crypto_source_mutations including defaults) on commit drop"
            )
            await db.copy_records_to_table(
                "adopted_mutations",
                records=[tuple(m.values()) for m in mutations],
                schema_name="pg_temp",
                columns=list(mutations[0]),
            )
            await db.execute(
                "create temp table adoption_times(source text primary key,target text) on commit drop"
            )
            await db.copy_records_to_table(
                "adoption_times",
                records=list(times.items()),
                schema_name="pg_temp",
                columns=["source", "target"],
            )
            for field in ("before_row", "after_row"):
                for key in ("created_at", "updated_at"):
                    await db.execute(
                        f"update adopted_mutations m set {field}=jsonb_set({field},'{{{key}}}',to_jsonb(t.target)) from adoption_times t where m.{field}->>'{key}'=t.source"
                    )
            # Carry non-financial explanatory notes, keeping unknowns visible even
            # when a position is recreated. They never change quantities or costs.
            for raw in original["crypto_protocol_positions"].values():
                obj = decode(raw)
                if "historical_accrual_note" in obj.get("metadata", {}):
                    for field in ("before_row", "after_row"):
                        await db.execute(
                            f"update adopted_mutations set {field}=jsonb_set({field},'{{metadata,historical_accrual_note}}',$2::jsonb->'metadata'->'historical_accrual_note') where table_name='crypto_protocol_positions' and row_key->>'id'=$1 and {field} is not null",
                            str(obj["id"]),
                            raw,
                        )
            policy_absent = [
                str(decode(raw)["id"])
                for raw in original["portfolio_events"].values()
                if decode(raw).get("metadata", {}).get("basis_policy") is None
            ]
            await db.execute(
                "update adopted_mutations set before_row=before_row#-'{metadata,basis_policy}',after_row=after_row#-'{metadata,basis_policy}' where table_name='portfolio_events' and row_key->>'id'=any($1::text[]) and (before_row#>>'{metadata,basis_policy}'='journal' or after_row#>>'{metadata,basis_policy}'='journal')",
                policy_absent,
            )
            liability_absent = [
                str(decode(raw)["id"])
                for raw in original["crypto_liability_events"].values()
                if "collateral_position_id"
                not in decode(raw).get("metadata", {}).get("result", {})
            ]
            await db.execute(
                "update adopted_mutations set before_row=before_row#-'{metadata,result,collateral_position_id}',after_row=after_row#-'{metadata,result,collateral_position_id}' where table_name='crypto_liability_events' and row_key->>'id'=any($1::text[]) and after_row#>'{metadata,result,collateral_position_id}'=after_row#>'{metadata,result,protocol_position_id}'",
                liability_absent,
            )
            print("Normalized source snapshots", flush=True)
            # Get reviewed external suffix by ledger links, not name/amount similarity.
            tail = await db.fetch("""select o.* from budgeting.operations o where owner_user_id=478559604
            and id>(select max(ledger_id) from budgeting.crypto_source_event_links where ledger_table='operations')
            order by id""")
            assert [r["id"] for r in tail] == list(range(22305, 22322))
            tailids = [r["id"] for r in tail]
            before_tail = {r["table_name"]: {} for r in mutations}
            for m in await db.fetch(
                "select distinct on(table_name,row_key) table_name,row_key::text key,after_row::text row from adopted_mutations order by table_name,row_key,id desc"
            ):
                before_tail[m["table_name"]][m["key"]] = m["row"]
            # Tail command inputs are reconstructed from original ledgers and
            # explicit sale metadata. All outputs are compared to original rows.
            commands = []
            for op in tail:
                oid = op["id"]
                payload = dict(
                    comment=op["comment"], operated_at=str(op["operated_on"])
                )
                be = await db.fetch(
                    "select * from budgeting.bank_entries where operation_id=$1 order by id",
                    oid,
                )
                ce = await db.fetch(
                    "select * from budgeting.crypto_bank_entries where operation_id=$1 order by id",
                    oid,
                )
                bu = await db.fetch(
                    "select * from budgeting.budget_entries where operation_id=$1 order by id",
                    oid,
                )
                sale = await db.fetchrow(
                    "select e.id,p.investment_account_id from budgeting.portfolio_events e join budgeting.portfolio_positions p on p.id=e.position_id where (e.metadata#>>'{manual_expense_settlement,result,operation_id}')::bigint=$1",
                    oid,
                )
                if sale:
                    assert len(be) == len(bu) == 1
                    kind = "bank_settle_sale"
                    anchor = sale["investment_account_id"]
                    payload.update(
                        investment_account_id=anchor,
                        sale_event_id=sale["id"],
                        category_id=bu[0]["category_id"],
                    )
                elif op["type"] == "allocate":
                    assert not be and not ce and len(bu) == 2
                    neg = next(x for x in bu if x["amount"] < 0)
                    pos = next(x for x in bu if x["amount"] > 0)
                    assert -neg["amount"] == pos["amount"]
                    kind = "budget_allocate"
                    anchor = 73
                    payload.update(
                        from_category_id=neg["category_id"],
                        to_category_id=pos["category_id"],
                        amount=str(pos["amount"]),
                    )
                elif op["type"] == "exchange":
                    assert len(be) == len(ce) == 1 and not bu
                    kind = "bank_purchase"
                    anchor = be[0]["bank_account_id"]
                    payload.update(
                        bank_account_id=anchor,
                        fiat_currency_code=be[0]["currency_code"],
                        fiat_amount=str(-be[0]["amount"]),
                        crypto_asset_id=ce[0]["crypto_asset_id"],
                        quantity=str(ce[0]["amount"]),
                    )
                else:
                    assert op["type"] == "expense" and len(bu) == 1
                    if ce:
                        assert len(ce) == 1 and not be
                        kind = "bank_crypto_expense"
                        anchor = ce[0]["bank_account_id"]
                        payload.update(
                            bank_account_id=anchor,
                            crypto_asset_id=ce[0]["crypto_asset_id"],
                            amount=str(-ce[0]["amount"]),
                        )
                    else:
                        assert len(be) == 1
                        kind = "bank_expense"
                        anchor = be[0]["bank_account_id"]
                        payload.update(
                            bank_account_id=anchor,
                            currency_code=be[0]["currency_code"],
                            amount=str(-be[0]["amount"]),
                        )
                    payload["category_id"] = bu[0]["category_id"]
                commands.append((dict(op), anchor, kind, payload))
            # Save all insert identities before removing the suffix in this isolated
            # transaction. No existing identity/created timestamp may be replaced.
            identity = []
            for op, _anchor, _kind, _payload in commands:
                oid = op["id"]
                identity.append(
                    (oid, "operations", original["operations"][json.dumps({"id": oid})])
                )
                for table in (
                    "bank_entries",
                    "budget_entries",
                    "crypto_bank_entries",
                    "lot_consumptions",
                    "crypto_lot_consumptions",
                    "fx_lots",
                    "crypto_lots",
                ):
                    col = (
                        "opened_by_operation_id"
                        if table.endswith("_lots")
                        else "operation_id"
                    )
                    for r in await db.fetch(
                        f"select to_jsonb(t)::text row from budgeting.{table} t where {col}=$1 order by id",
                        oid,
                    ):
                        identity.append((oid, table, r["row"]))
            for table in (
                "lot_consumptions",
                "crypto_lot_consumptions",
                "bank_entries",
                "budget_entries",
                "crypto_bank_entries",
                "fx_lots",
                "crypto_lots",
                "operations",
            ):
                col = (
                    "id"
                    if table == "operations"
                    else "opened_by_operation_id"
                    if table.endswith("_lots")
                    else "operation_id"
                )
                await db.execute(
                    f"delete from budgeting.{table} where {col}=any($1::bigint[])",
                    tailids,
                )
            print("Prepared original bank identities", flush=True)
            # Rewind every touched journal row to its proven final audit image.
            for table, items in before_tail.items():
                if table == "crypto_source_event_links":
                    continue
                for raw in items.values():
                    if raw is not None:
                        await putrow(db, table, raw)
            # Categories absent from journal mutations only received tail postings.
            for r in await db.fetch(
                "select category_id,currency_code,sum(amount) amount from jsonb_populate_recordset(NULL::budgeting.budget_entries,$1::jsonb) where operation_id=any($2::bigint[]) group by 1,2",
                "[" + ",".join(original["budget_entries"].values()) + "]",
                tailids,
            ):
                key = json.dumps(
                    {
                        "category_id": r["category_id"],
                        "currency_code": r["currency_code"],
                    },
                    sort_keys=True,
                )
                if not any(
                    decode(k) == decode(key)
                    for k in before_tail.get("current_budget_balances", {})
                ):
                    await db.execute(
                        "update budgeting.current_budget_balances set amount=amount-$3 where category_id=$1 and currency_code=$2",
                        r["category_id"],
                        r["currency_code"],
                        r["amount"],
                    )
            # New crypto asset in the tail may have no historical balance image.
            await db.execute(
                "delete from budgeting.current_crypto_balances b where bank_account_id=73 and crypto_asset_id=2 and not exists(select 1 from adopted_mutations where table_name='current_crypto_balances' and row_key=to_jsonb(b)-'amount'-'historical_cost_in_base'-'updated_at')"
            )
            # Prepare audited histories and identity queue used by the real engine.
            await db.execute(
                "insert into budgeting.crypto_source_mutations select * from adopted_mutations"
            )
            await db.execute(
                "select setval(pg_get_serial_sequence('budgeting.crypto_source_mutations','id'),(select max(id) from budgeting.crypto_source_mutations))"
            )
            await db.execute(
                "update budgeting.crypto_source_events set reversible=true"
            )
            await db.execute(
                "create temp table crypto_replay_identity (like budgeting.crypto_source_mutations including defaults) on commit drop"
            )
            await db.execute(
                "alter table crypto_replay_identity add column used boolean default false not null"
            )
            print("Restored pre-tail state", flush=True)
            for i, (op, anchor, kind, payload) in enumerate(commands):
                sid = await db.fetchval(
                    """insert into budgeting.crypto_source_events(owner_key,anchor_account_id,source_namespace,source_id,occurred_at,order_in_timestamp,accounting_date,commands,evidence,created_by_user_id,created_at)
                values('user:478559604',$1,'bank-legacy-v1',$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$3) returning id""",
                    anchor,
                    str(op["id"]),
                    op["created_at"],
                    i,
                    op["created_at"].date(),
                    json.dumps([dict(kind=kind, payload=payload)]),
                    json.dumps(
                        dict(
                            original_operation_id=op["id"],
                            effective_date=str(op["operated_on"]),
                            adoption="verified original ledger",
                        )
                    ),
                    op["actor_user_id"],
                )
                for oid, table, raw in identity:
                    if oid == op["id"]:
                        await db.execute(
                            "insert into pg_temp.crypto_replay_identity(source_event_id,revision,command_index,table_name,row_key,before_row,after_row) values($1,1,0,$2,jsonb_build_object('id',($3::jsonb->>'id')::bigint),null,$3::jsonb)",
                            sid,
                            table,
                            raw,
                        )
                await db.execute(
                    "select set_config('budgeting.crypto_replaying','on',true),set_config('budgeting.crypto_replay_source',$1,true)",
                    str(sid),
                )
                await db.fetchval(
                    "select budgeting.put__crypto_source_event($1,$2,'bank-legacy-v1',$3,$4,$5,$6,$7::jsonb,$8::jsonb)",
                    op["actor_user_id"],
                    anchor,
                    str(op["id"]),
                    op["created_at"],
                    i,
                    op["created_at"].date(),
                    json.dumps([dict(kind=kind, payload=payload)]),
                    json.dumps(
                        dict(
                            original_operation_id=op["id"],
                            effective_date=str(op["operated_on"]),
                            adoption="verified original ledger",
                        )
                    ),
                )
            assert not await db.fetchval(
                "select exists(select 1 from pg_temp.crypto_replay_identity where not used)"
            )
            await db.execute(
                "select set_config('budgeting.crypto_replaying','off',true),set_config('budgeting.crypto_replay_source','',true)"
            )
            # Only transient update timestamps may differ. Restore original timestamps
            # and align the final audit after-image; financial/metadata values must match.
            terminal = {
                (r["table_name"], r["key"]): r["id"]
                for r in await db.fetch(
                    "select distinct on(table_name,row_key) table_name,row_key::text key,id from budgeting.crypto_source_mutations order by table_name,row_key,id desc"
                )
            }
            diffs = []
            for table, expected in original.items():
                actual = await rows(db, table)
                if expected.keys() != actual.keys():
                    diffs.append(
                        (
                            table,
                            "keys",
                            list(expected.keys() - actual.keys())[:5],
                            list(actual.keys() - expected.keys())[:5],
                        )
                    )
                    continue
                for key, raw in expected.items():
                    a, b = decode(raw), decode(actual[key])
                    a.pop("updated_at", None)
                    b.pop("updated_at", None)
                    if a != b:
                        diffs.append(
                            (
                                table,
                                key,
                                {
                                    k: [str(a.get(k)), str(b.get(k))]
                                    for k in a.keys() | b.keys()
                                    if a.get(k) != b.get(k)
                                },
                            )
                        )
                        continue
                    if not same(raw, actual[key]):
                        await putrow(db, table, raw)
                    # The last image is the authoritative existing row including its
                    # original timestamp. Earlier images retain mapped source times.
                    await db.execute(
                        "update budgeting.crypto_source_mutations set after_row=$2::jsonb where id=$1",
                        terminal.get((table, key)),
                        raw,
                    )
            (OUT / "differences.json").write_text(
                json.dumps(diffs, indent=2, ensure_ascii=False)
            )
            if diffs:
                raise RuntimeError(f"{len(diffs)} differences; see adoption artifact")
            # Prove chain continuity per key after annotation/time normalization.
            conflict = await db.fetchval(
                """select count(*) from (select before_row,lag(after_row) over(partition by table_name,row_key order by id) previous,row_number() over(partition by table_name,row_key order by id) n from budgeting.crypto_source_mutations) s where n>1 and before_row is distinct from previous"""
            )
            assert conflict == 0, ("audit discontinuity", conflict)
            for table, expected in original.items():
                actual = await rows(db, table)
                assert all(same(raw, actual[key]) for key, raw in expected.items())
            report = dict(
                sources=1977,
                legacy_sources=1960,
                bank_operations=17,
                unchanged_financial_tables=len(FINANCIAL),
                audit_rows=await db.fetchval(
                    "select count(*) from budgeting.crypto_source_mutations"
                ),
            )
            (OUT / "adopted.json").write_text(json.dumps(report, indent=2))
            print(report)
    finally:
        await fresh.close()
        await db.close()


async def test_full_chain():
    from uuid import uuid4
    import time

    db = await asyncpg.connect(**{**credentials(), "database": DB})
    try:
        for name in ("capture__crypto_mutation", "get__crypto_correction_history"):
            await db.execute(
                (ROOT / f"infra/db/Scripts/budgeting/func/{name}.sql").read_text()
            )

        async def fingerprint():
            return {
                t: await db.fetchval(
                    f"select md5(coalesce(string_agg(to_jsonb(x)::text,E'\\n' order by to_jsonb(x)::text),'')) from budgeting.{t} x"
                )
                for t in FINANCIAL
                + (
                    "crypto_source_events",
                    "crypto_source_event_links",
                    "crypto_source_mutations",
                    "crypto_source_revisions",
                    "crypto_source_corrections",
                )
            }

        before = await fingerprint()
        notes = await db.fetchval(
            "select jsonb_object_agg(id,metadata->'historical_accrual_note') from budgeting.crypto_protocol_positions where metadata ? 'historical_accrual_note'"
        )
        bankrows = await db.fetchval(
            "select jsonb_agg(to_jsonb(o) order by id) from budgeting.operations o where id between 22305 and 22321"
        )
        tx = db.transaction()
        await tx.start()
        try:
            request = uuid4()
            changes = json.dumps(
                [dict(command_index=0, field="fiat_amount", value="1030.00")]
            )
            started = time.monotonic()
            sql = "select budgeting.put__correct_crypto_source(478559604,1,1,$1,$2::jsonb,$3,$4,$5)"
            reason = "Acceptance test only; transaction rolled back"
            preview = decode(
                await db.fetchval(sql, request, changes, reason, False, None)
            )
            assert preview["replayed_sources"] == 1977 and not preview["applied"]
            assert before == await fingerprint()
            print(
                "Full preview passed", round(time.monotonic() - started, 2), flush=True
            )
            applied = decode(
                await db.fetchval(
                    sql, request, changes, reason, True, preview["preview_token"]
                )
            )
            assert applied["applied"] and applied["replayed_sources"] == 1977
            assert applied == decode(
                await db.fetchval(
                    sql, request, changes, reason, True, preview["preview_token"]
                )
            )
            assert bankrows == await db.fetchval(
                "select jsonb_agg(to_jsonb(o) order by id) from budgeting.operations o where id between 22305 and 22321"
            )
            assert notes == await db.fetchval(
                "select jsonb_object_agg(id,metadata->'historical_accrual_note') from budgeting.crypto_protocol_positions where metadata ? 'historical_accrual_note'"
            )
            assert await db.fetchval(
                "select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='RUB'"
            ) == Decimal("44574.562268")
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.crypto_source_revisions"
                )
                == 1977
            )
            assert (
                await db.fetchval(
                    "select count(*) from budgeting.crypto_source_corrections"
                )
                == 1
            )
            (OUT / "full-chain-test.json").write_text(
                json.dumps(
                    dict(
                        preview=preview,
                        applied=applied,
                        elapsed_seconds=time.monotonic() - started,
                        bank_operation_ids_dates_preserved=True,
                        annotations_preserved=True,
                    ),
                    default=str,
                    indent=2,
                )
            )
            print(
                "Full apply and idempotent retry passed",
                round(time.monotonic() - started, 2),
                flush=True,
            )
        finally:
            await tx.rollback()
        assert before == await fingerprint()
        (OUT / "accepted.json").write_text(
            json.dumps(
                dict(
                    full_preview_apply_retry_rollback=True,
                    unchanged_tables=len(before),
                    sources=1977,
                ),
                indent=2,
            )
        )
        print("All tables identical after acceptance transaction rollback", flush=True)
    finally:
        await db.close()


async def publish():
    proof = json.loads((OUT / "accepted.json").read_text())
    assert proof["full_preview_apply_retry_rollback"] is True
    cfg = credentials()
    source = await asyncpg.connect(**{**cfg, "database": DB})
    target = await asyncpg.connect(**{**cfg, "database": "budget_bot"})
    try:
        async with target.transaction():
            await target.execute(
                "select pg_advisory_xact_lock(hashtextextended('crypto-source:user:478559604',0))"
            )
            for table in FINANCIAL + (
                "crypto_source_events",
                "crypto_source_event_links",
                "crypto_source_mutations",
                "crypto_source_revisions",
                "crypto_source_corrections",
            ):
                await target.execute(
                    f"lock table budgeting.{table} in share row exclusive mode"
                )
            assert (
                await target.fetchval(
                    "select count(*) from budgeting.crypto_source_events"
                )
                == 1960
            )
            assert (
                await target.fetchval(
                    "select count(*) from budgeting.crypto_source_mutations"
                )
                == 0
            )
            financial = {t: await rows(target, t) for t in FINANCIAL}
            for table, expected in financial.items():
                actual = await rows(source, table)
                assert expected.keys() == actual.keys(), (
                    "new rows since snapshot",
                    table,
                )
                assert all(same(raw, actual[key]) for key, raw in expected.items()), (
                    "new changes since snapshot",
                    table,
                )
            old = await rows(target, "crypto_source_events")
            new = await rows(source, "crypto_source_events")
            for key, raw in old.items():
                a, b = decode(raw), decode(new[key])
                a.pop("reversible")
                b.pop("reversible")
                assert a == b, ("source changed since snapshot", key)
            # Backup remains a separate durable dump; this transaction never
            # replaces the database, ledger rows or existing source envelopes.
            for name in ("capture__crypto_mutation", "get__crypto_correction_history"):
                await target.execute(
                    (ROOT / f"infra/db/Scripts/budgeting/func/{name}.sql").read_text()
                )
            entries = await source.fetch(
                "select * from budgeting.crypto_source_events order by id"
            )
            fresh = [
                tuple(r.values())
                for r in entries
                if json.dumps({"id": r["id"]}) not in old
            ]
            assert len(fresh) == 17
            await target.copy_records_to_table(
                "crypto_source_events",
                schema_name="budgeting",
                columns=list(entries[0].keys()),
                records=fresh,
            )
            for table in ("crypto_source_mutations", "crypto_source_event_links"):
                records = await source.fetch(f"select * from budgeting.{table}")
                if table == "crypto_source_event_links":
                    current = await target.fetch(f"select * from budgeting.{table}")
                    known = {tuple(r.values()) for r in current}
                    records = [r for r in records if tuple(r.values()) not in known]
                await target.copy_records_to_table(
                    table,
                    schema_name="budgeting",
                    columns=list(records[0].keys()),
                    records=[tuple(r.values()) for r in records],
                )
            await target.execute(
                "update budgeting.crypto_source_events set reversible=true"
            )
            for table in ("crypto_source_events", "crypto_source_mutations"):
                seq = await target.fetchval(
                    "select pg_get_serial_sequence($1,'id')", "budgeting." + table
                )
                last = await target.fetchval(f"select last_value from {seq}")
                maximum = await target.fetchval(
                    f"select max(id) from budgeting.{table}"
                )
                await target.fetchval(
                    "select setval($1::regclass,$2)", seq, max(last, maximum)
                )
            for table, expected in financial.items():
                actual = await rows(target, table)
                assert expected == actual, (
                    "publication changed financial table",
                    table,
                )
            assert (
                await target.fetchval(
                    "select count(*) from budgeting.crypto_source_events where reversible"
                )
                == 1977
            )
            result = dict(
                visible_dev_published=True,
                financial_tables_unchanged=len(FINANCIAL),
                reversible_sources=1977,
                legacy_sources=1960,
                bank_tail=17,
            )
        (OUT / "published.json").write_text(json.dumps(result, indent=2))
        print(result)
    finally:
        await source.close()
        await target.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--setup", action="store_true")
    mode.add_argument("--adopt", action="store_true")
    mode.add_argument("--test", action="store_true")
    mode.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    asyncio.run(
        setup()
        if args.setup
        else test_full_chain()
        if args.test
        else publish()
        if args.publish
        else adopt()
    )
