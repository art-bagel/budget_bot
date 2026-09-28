"""Audit R1 against local Docker dev; optionally apply presentation-only notes.

No balances, source commands or accounting events are rewritten. Reports contain
personal data and belong in ignored outputs/. Only the two local dev DBs allowed.
"""

import argparse
import asyncio
from collections import defaultdict
from decimal import Decimal as D
import hashlib
import json

import asyncpg

from prepare_docker_history import ROOT, UID, credentials

CUTOFF = "2026-09-06T15:13:53+00:00"


def decode(value):
    return json.loads(value, parse_float=D) if isinstance(value, str) else value


def summarize(sources, liabilities, protocols):
    positions = {p["id"]: p for p in protocols}
    event_map = {e["id"]: e for e in liabilities}
    rows = []
    last = {}
    for source in sources:
        commands, results = (
            decode(source["commands"]),
            decode(source["result"])["results"],
        )
        for index, command in enumerate(commands):
            kind, payload = command["kind"], command["payload"]
            pid = payload.get("position_id")
            if pid in positions and kind != "tag_lending_account":
                last[pid] = dict(
                    source_id=source["source_id"],
                    at=str(source["occurred_at"]),
                    kind=kind,
                )
            if (
                kind not in ("liquidate", "repay")
                or positions.get(pid, {}).get("protocol_name") != "EVAA"
            ):
                continue
            result = results[index]
            groups = defaultdict(D)
            for settlement in result.get("funding", {}).get("settlements", []):
                groups[settlement["holder_kind"]] += D(str(settlement["cost"]))
            entry = dict(
                source_id=source["source_id"],
                date=str(source["accounting_date"]),
                kind=kind,
                protocol_id=pid,
                holders_at_settlement=dict(groups),
            )
            if kind == "liquidate":
                liability = event_map[result["liability_event_id"]]
                meta = decode(liability["metadata"])
                principal_cost = D(str(meta["funding_principal_cost"]))
                expense_cost = D(str(meta["funding_expense_cost"]))
                collateral_cost = D(str(result["collateral_cost_consumed_in_base"]))
                assert principal_cost + expense_cost == collateral_cost
                assert sum(groups.values()) == principal_cost
                entry.update(
                    collateral_symbol=positions[pid]["asset_symbol"],
                    collateral_quantity=payload["collateral_qty"],
                    collateral_cost_at_event=collateral_cost,
                    debt_quantity=payload["debt_qty"],
                    principal_quantity=D(payload["debt_qty"])
                    - D(payload.get("interest_qty", "0")),
                    interest_quantity=payload.get("interest_qty", "0"),
                    principal_cost_at_event=principal_cost,
                    expense_cost_at_event=expense_cost,
                    penalty_quantity=None
                    if D(payload.get("collateral_fee_qty", "0")) == 0
                    else payload["collateral_fee_qty"],
                )
            rows.append(entry)
    assert len([r for r in rows if r["kind"] == "liquidate"]) == 5
    return dict(
        cutoff=CUTOFF,
        settlements=rows,
        last_protocol_actions=last,
        amount_semantics="Costs and destinations at each settlement, not final balances; later loan settlement can add cost.",
    )


def notes_for(protocols):
    notes = {}
    for p in protocols:
        if p["status"] != "open":
            continue
        if p["protocol_name"] == "Aave V3":
            assert D(str(p["quantity"])) == D("0.189058962431595386")
            assert D(str(decode(p["metadata"])["borrowed_quantity"])) == D("168.666998")
            notes[p["id"]] = (
                "Срез 06.09.2026: залог 0,189058962431595386 ETH — по действию 12.06.2025; "
                "долг 168,666998 USDC — после погашения 03.02.2026. "
                "Последующие пассивные начисления до даты среза не подтверждены. "
                "Рыночная стоимость и средняя цена на эту дату требуют уточнения количества. "
                "Это не текущий баланс Aave."
            )
        elif p["protocol_name"] == "TON Nominator":
            assert D(str(p["quantity"])) == D("2315")
            notes[p["id"]] = (
                "Срез 06.09.2026: 2315 TON — сумма внесённых средств по истории, "
                "последнее пополнение 04.08.2026. Накопленные награды отдельно не подтверждены "
                "и не включены в количество. Их начисление увеличит количество без новых затрат покупки."
            )
        elif p["protocol_name"] == "EVAA":
            if D(str(p["quantity"])) == 0:
                notes[p["id"]] = (
                    "Срез 06.09.2026: залог выведен, долг счёта погашен 04.08.2026. "
                    "Последующее начисление на выведенный залог не добавляется. "
                    "Отдельная штрафная часть прежних ликвидаций не установлена; "
                    "изъятый залог не равен убытку целиком."
                )
            else:
                assert p["asset_symbol"] in ("stTON", "stGRAM")
                assert D(str(p["quantity"])) == D("0.000078288")
                notes[p["id"]] = (
                    "Срез 06.09.2026: остаток 0,000078288 stGRAM (stTON) сохранён "
                    "по последнему подтверждённому индексу ранней истории. "
                    "Прирост этой пыли до даты среза не определён; долг EVAA погашен. "
                    "Это не актуальный сетевой снимок."
                )
    assert len(notes) == 7
    return notes


async def run(args):
    params = credentials()
    params["database"] = args.database
    db = await asyncpg.connect(**params)
    output = ROOT / "outputs/crypto-r1-audit"
    output.mkdir(parents=True, exist_ok=True)
    try:
        async with db.transaction(isolation="serializable", readonly=not args.apply):
            assert await db.fetchval("select current_database()") == args.database
            sources = [
                dict(r)
                for r in await db.fetch(
                    "select * from budgeting.crypto_source_events where anchor_account_id=92 order by occurred_at,order_in_timestamp"
                )
            ]
            assert len(sources) == 1960 and all(
                s["created_by_user_id"] == UID for s in sources
            )
            protocols = [
                dict(r)
                for r in await db.fetch(
                    "select * from budgeting.crypto_protocol_positions where owner_user_id=$1 order by id",
                    UID,
                )
            ]
            liabilities = [
                dict(r)
                for r in await db.fetch(
                    "select * from budgeting.crypto_liability_events where created_by_user_id=$1 order by id",
                    UID,
                )
            ]
            report = summarize(sources, liabilities, protocols)
            notes = notes_for(protocols)
            report["notes"] = notes
            report["source_sha256"] = hashlib.sha256(
                json.dumps(sources, default=str, sort_keys=True).encode()
            ).hexdigest()
            report["database"] = args.database
            report["applied"] = args.apply
            before = {
                str(p["id"]): decode(p["metadata"])
                for p in protocols
                if p["id"] in notes
            }
            if args.apply:
                function_backup = (
                    output / f"{args.database}-history-function-before.sql"
                )
                if not function_backup.exists():
                    definition = await db.fetchval(
                        "select pg_get_functiondef('budgeting.get__crypto_protocol_history(bigint,bigint,integer,integer)'::regprocedure)"
                    )
                    function_backup.write_text(definition + ";\n")
                backup = output / f"{args.database}-notes-before.json"
                if not backup.exists():
                    backup.write_text(
                        json.dumps(before, default=str, ensure_ascii=False, indent=2)
                        + "\n"
                    )
                await db.execute(
                    (
                        ROOT
                        / "infra/db/Scripts/budgeting/func/get__crypto_protocol_history.sql"
                    ).read_text()
                )
                for pid, note in notes.items():
                    await db.execute(
                        """update budgeting.crypto_protocol_positions
                        set metadata=metadata||jsonb_build_object('historical_accrual_note',$1::text),
                            updated_at=current_timestamp
                        where id=$2 and owner_user_id=$3
                          and metadata->>'historical_accrual_note' is distinct from $1""",
                        note,
                        pid,
                        UID,
                    )
            # Read-side acceptance: exact body, not a second debt/expense posting.
            if args.apply:
                count = 0
                for pid in {
                    e["protocol_id"]
                    for e in report["settlements"]
                    if e["kind"] == "liquidate"
                }:
                    history = decode(
                        await db.fetchval(
                            "select budgeting.get__crypto_protocol_history($1,$2,200,0)",
                            UID,
                            pid,
                        )
                    )
                    body = [
                        e
                        for e in history["entries"]
                        if e["kind"] == "liquidation_principal"
                    ]
                    expected = [
                        e
                        for e in report["settlements"]
                        if e["kind"] == "liquidate" and e["protocol_id"] == pid
                    ]
                    assert len(body) == len(expected)
                    assert sum(D(str(e["cost_basis"])) for e in body) == sum(
                        e["principal_cost_at_event"] for e in expected
                    )
                    count += len(body)
                assert count == 5
                after = [
                    dict(r)
                    for r in await db.fetch(
                        "select * from budgeting.crypto_source_events where anchor_account_id=92 order by occurred_at,order_in_timestamp"
                    )
                ]
                assert sources == after
                updated = [
                    dict(r)
                    for r in await db.fetch(
                        "select * from budgeting.crypto_protocol_positions where owner_user_id=$1 order by id",
                        UID,
                    )
                ]
                for old, new in zip(protocols, updated, strict=True):
                    assert {
                        k: v
                        for k, v in old.items()
                        if k not in ("metadata", "updated_at")
                    } == {
                        k: v
                        for k, v in new.items()
                        if k not in ("metadata", "updated_at")
                    }
                    m = decode(new["metadata"])
                    m.pop("historical_accrual_note", None)
                    n = decode(old["metadata"])
                    n.pop("historical_accrual_note", None)
                    assert m == n
        (output / f"{args.database}-report.json").write_text(
            json.dumps(report, default=str, ensure_ascii=False, indent=2) + "\n"
        )
        print(
            json.dumps(
                dict(
                    database=args.database,
                    applied=args.apply,
                    source_count=len(sources),
                    liquidations=5,
                    accrual_notes=len(notes),
                    source_sha256=report["source_sha256"],
                )
            )
        )
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        choices=["crypto_merge_preview", "budget_bot"],
        default="crypto_merge_preview",
    )
    parser.add_argument("--apply", action="store_true")
    asyncio.run(run(parser.parse_args()))
