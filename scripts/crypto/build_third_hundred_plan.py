"""Compile accepted 201–300 quantities with carry-cost policies and owner updates."""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from build_first_block_replay import PIN, TON, USDT
from build_history_inventory import ROOT, git
from build_second_hundred_plan import JETTON, command, position
from compile_main_commands import ref

BASE = "crypto-task/chronological-rebuild/blocks/0201-0300/accepted/v1/"


def build(prefix):
    plan = json.loads(prefix.read_text())
    original = deepcopy(plan["rows"])
    inputs = []

    def accepted(name):
        raw = git("show", PIN + ":" + BASE + name)
        inputs.append(
            dict(path=BASE + name, commit=PIN, sha256=hashlib.sha256(raw).hexdigest())
        )
        return json.loads(raw)

    reviews = accepted("review.json")
    econ = {r["event_no"]: r for r in accepted("economic-review.json")}
    facts = accepted("protocol-facts.json")
    checkpoint = accepted("checkpoint.json")
    custody = accepted("custody-ledger.json")
    owner = accepted("owner-decisions.json")
    nexton = accepted("nexton-evidence.json")
    external = accepted("external-verification.json")
    events = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json"
        ).read_text()
    )
    moves = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json"
        ).read_text()
    )
    telegram = {
        r["source_row"]: r
        for r in json.loads(
            (
                ROOT
                / "outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json"
            ).read_text()
        )
    }
    assets = plan["assets"]
    excluded = {}
    for m in moves:
        if 200 < m["event_no"] <= 300 and "LP" not in m["asset"]:
            if m["excluded_from_financial_perimeter"]:
                excluded[m["master"]] = dict(
                    symbol=m["asset"], reason="accepted excluded unsolicited token"
                )
            else:
                assets.setdefault(
                    m["master"], dict(symbol=m["asset"], decimals=m["decimals"])
                )
    # Preserve the accepted perimeter, including scam receipts not flagged in raw metadata.
    for r in reviews:
        if any("Нежелательный/исключённый" in x for x in econ[r["event_no"]]["notes"]):
            for m in r["net_movements"]:
                if m["master"] != TON:
                    excluded[m["master"]] = dict(
                        symbol=m["asset"], reason="accepted excluded unsolicited token"
                    )
                    assets.pop(m["master"], None)
    lots = []
    for row in original:
        for c in row["commands"]:
            p = c["payload"]
            if (
                c["kind"] == "create_protocol"
                and p["position_type"] == "liquidity_pool"
            ):
                lp = p["metadata"]["lp_receipt"]
                lots.append(
                    dict(
                        event_id=lp["event_id"],
                        master=lp["master"],
                        quantity=D(lp["quantity"]),
                        a=p["crypto_asset_id"]["resource_ref"].split("asset:ton:")[1],
                        b=p["secondary_source_position_id"]["resource_ref"].split(
                            "position:main:ton:"
                        )[1],
                        custody="main",
                        open=True,
                    )
                )
            elif c["kind"] in ("close_protocol", "lp_custody"):
                key = p["position_id"]["resource_ref"].split("protocol:")[1]
                lot = next((x for x in lots if x["event_id"] == key), None)
                if lot:
                    if c["kind"] == "close_protocol":
                        lot["open"] = False
                    else:
                        lot["custody"] = p["to_custody"]
    running = {
        k: D(v)
        for k, v in next(r for r in reversed(original) if r.get("event_no") == 200)[
            "expected_main"
        ].items()
    }
    appended = []

    def add(sid, when, order, cmds, evidence, **extra):
        appended.append(
            dict(
                source_id=sid,
                occurred_at=when.astimezone(timezone.utc).isoformat(),
                accounting_date=when.astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=order,
                commands=cmds,
                evidence=evidence,
                **extra,
            )
        )

    def reward(wallet, asset, q):
        return command(
            "reward",
            investment_account_id=ref("account", wallet),
            crypto_asset_id=ref("asset", "ton", asset),
            quantity=str(q),
        )

    # Telegram source rows are outside main's chain but affect remaining portfolio cost.
    hmstr = "service:telegram:HMSTR"
    assets[hmstr] = dict(symbol="HMSTR", decimals=9, network_code="telegram")
    tg_commands = {
        104: [reward("telegram", hmstr, "1479.7633")],
        105: [
            command(
                "transfer",
                position_id=position("telegram", hmstr),
                target_investment_account_id=ref("account", "telegram_yield"),
                amount="1479.7633",
            )
        ],
        106: [
            command(
                "transfer",
                position_id=position("telegram_yield", hmstr),
                target_investment_account_id=ref("account", "telegram"),
                amount="1479.7633",
            )
        ],
        107: [reward("telegram", hmstr, "60.813")],
        108: [
            command(
                "swap",
                position_id=position("telegram"),
                from_amount="0.5",
                to_crypto_asset_id=ref("asset", "ton", USDT),
                to_amount="2.7",
                basis_policy="carry",
            )
        ],
        109: [
            command(
                "expense",
                source_position_id=position("telegram", USDT),
                quantity="2.33",
                comment="Внешний перевод Telegram; назначение владелец не помнит, неизвестное направление сохранено",
            )
        ],
    }
    for n, cmds in tg_commands.items():
        r = telegram[n]
        when = datetime.fromisoformat(
            r["date"] + "T" + (r["time_as_in_source"] or "00:00")
        ).replace(tzinfo=ZoneInfo("Europe/Moscow"))
        evidence = dict(
            source=r,
            time_quality="minute"
            if r["time_as_in_source"]
            else "date_only_placeholder",
        )
        if n == 108:
            evidence["owner_confirmation"] = (
                "0.5 TON exchanged for 2.7 USDT, confirmed in this conversation"
            )
        if n == 109:
            evidence["classification"] = (
                "Unknown external destination; expense under accepted unknown outflow convention, not confirmed purchase"
            )
        add(r["source_key"], when, n, cmds, evidence)

    deposits = {218, 234, 239, 285, 289, 295, 299}
    exits = {217, 227, 233, 238, 284, 288, 294, 298}
    direct_stakes = {211, 246}
    direct_returns = {220: 113, 253: 211}
    sales = {
        228: ("58.839", "31655"),
        258: ("62.9", "30000"),
        281: ("42.61363", "30000"),
    }
    for review in reviews:
        n = review["event_no"]
        event = events[n - 1]
        actions = event["raw"]["actions"]
        main = event["raw"]["account"]["address"]
        net = {r["master"]: D(r["quantity"]) for r in review["net_movements"]}
        for a, q in net.items():
            running[a] = running.get(a, D(0)) + q
        cmds = []
        paid = D(0)
        received = D(0)
        evidence = dict(
            accepted_review=review,
            economic_review=econ[n],
            accepted_source=BASE + "review.json",
        )
        when = datetime.fromtimestamp(event["timestamp"], timezone.utc)
        # Wrapped TON transfers explicitly identify rewards/principal, independent of gas return.
        pton = sum(
            D(a["JettonTransfer"]["amount"]) / 10**9
            for a in actions
            if a["type"] == "JettonTransfer"
            and a["JettonTransfer"].get("jetton", {}).get("symbol") in ("pTON", "pGRAM")
            and a["JettonTransfer"].get("recipient", {}).get("address") == main
        )
        if n in sales:
            q, rub = sales[n]
            paid = D(q)
            cmds.append(
                command(
                    "bank_sell",
                    position_id=position("main"),
                    bank_account_id=ref("account", "primary_cash"),
                    quantity=q,
                    fiat_amount=rub,
                    comment=f"Продажа другу: {q} TON за {rub} ₽",
                )
            )
            evidence["owner_bank_proceeds"] = dict(
                TON=q,
                RUB=rub,
                source="owner bank statement amounts confirmed in conversation; supersedes old missing proceeds",
            )
        elif n in direct_stakes or n == 213:
            a = TON if n == 213 else JETTON
            q = D(90) if n == 213 else -net[a]
            cmds.append(
                command(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="NexTon" if n == 213 else "JETTON farming",
                    position_type="staking",
                    asset_symbol=assets[a]["symbol"],
                    quantity=str(q),
                    source_position_id=position("main", a),
                    crypto_asset_id=ref("asset", "ton", a),
                    network_code="ton",
                    metadata=dict(
                        source_event_id=event["event_id"],
                        **(
                            {"staking_nft": nexton["NFT"], "accepted_evidence": nexton}
                            if n == 213
                            else {}
                        ),
                    ),
                )
            )
            if a == TON:
                paid = q
        elif n in direct_returns or n == 278:
            origin = 213 if n == 278 else direct_returns[n]
            a = TON if n == 278 else JETTON
            q = (
                D(nexton["TON_received"])
                if n == 278
                else next(
                    D(c["payload"]["quantity"])
                    for r in (original + appended)
                    if r.get("event_no") == origin
                    for c in r["commands"]
                    if c["kind"] == "create_protocol"
                )
            )
            cmds.append(
                command(
                    "close_protocol",
                    position_id=ref("protocol", events[origin - 1]["event_id"]),
                    return_quantity=str(q),
                )
            )
            if a == TON:
                received = q
            elif net[a] > q:
                cmds.append(reward("main", a, net[a] - q))
        elif n in owner["expense_events"] or n in (250, 282):
            paid = sum(
                D(a["TonTransfer"]["amount"]) / 10**9
                for a in actions
                if a["type"] == "TonTransfer"
                and a["TonTransfer"].get("sender", {}).get("address") == main
            )
            assert paid > 0
            if n in (250, 282):
                cmds.append(
                    command(
                        "transfer",
                        position_id=position("main"),
                        target_investment_account_id=ref("account", "intermediate"),
                        amount=str(paid),
                    )
                )
                cmds.append(
                    command(
                        "fee",
                        source_position_id=position("intermediate"),
                        quantity=str(
                            D(
                                external["intermediate"]["fees_atomic_by_main_event"][
                                    str(n)
                                ]
                            )
                            / 10**9
                        ),
                        comment="Собственная комиссия intermediate, подтверждённая цепочкой транзакций",
                    )
                )
            else:
                cmds.append(
                    command(
                        "expense",
                        source_position_id=position("main"),
                        quantity=str(paid),
                        comment="Внешний расход по решению владельца",
                    )
                )
                evidence["owner_decision"] = owner
        elif n in deposits:
            lp, qlp = next(
                (m["master"], D(m["quantity"]))
                for m in review["net_movements"]
                if "LP" in m["asset"] and D(m["quantity"]) > 0
            )
            legs = [(a, -q) for a, q in net.items() if a != TON and q < 0]
            if len(legs) == 1:
                paid = D(facts[str(n)]["amounts"]["TON"])
                legs.insert(0, (TON, paid))
            assert len(legs) == 2
            (a, qa), (b, qb) = legs
            cmds.append(
                command(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="DeDust" if n in (218, 285, 289) else "STON.fi",
                    position_type="liquidity_pool",
                    asset_symbol=assets[a]["symbol"],
                    quantity=str(qa),
                    source_position_id=position("main", a),
                    crypto_asset_id=ref("asset", "ton", a),
                    secondary_source_position_id=position("main", b),
                    secondary_quantity=str(qb),
                    network_code="ton",
                    metadata={
                        "lp_receipt": dict(
                            master=lp,
                            quantity=str(qlp),
                            custody="main",
                            event_id=event["event_id"],
                        )
                    },
                )
            )
            lots.append(
                dict(
                    event_id=event["event_id"],
                    master=lp,
                    quantity=qlp,
                    a=a,
                    b=b,
                    custody="main",
                    open=True,
                )
            )
            evidence["principal_fact"] = facts.get(
                str(n), dict(source="accepted jetton net movements")
            )
        elif n in exits:
            lp, qlp = next((a, -q) for a, q in net.items() if a != TON and q < 0)
            selected = [
                x
                for x in lots
                if x["open"] and x["master"] == lp and x["custody"] == "main"
            ]
            assert sum(x["quantity"] for x in selected) == qlp, (n, selected, qlp)
            a, b = selected[0]["a"], selected[0]["b"]
            if TON in (a, b):
                received = pton if n == 227 else D(facts[str(n)]["amounts"]["TON"])
            returned = {k: received if k == TON else net[k] for k in (a, b)}
            remaining = dict(returned)
            for i, lot in enumerate(selected):
                allocation = {
                    k: remaining[k]
                    if i == len(selected) - 1
                    else (returned[k] * lot["quantity"] / qlp).quantize(
                        D(1).scaleb(-assets[k]["decimals"])
                    )
                    for k in (a, b)
                }
                for k, q in allocation.items():
                    remaining[k] -= q
                cmds.append(
                    command(
                        "close_protocol",
                        position_id=ref("protocol", lot["event_id"]),
                        return_quantity=str(allocation[lot["a"]]),
                        secondary_return_quantity=str(allocation[lot["b"]]),
                        allocation_policy="net_composition",
                    )
                )
                lot["open"] = False
        elif any(a["type"] == "JettonSwap" and a["status"] == "ok" for a in actions):
            swap = next(
                a["JettonSwap"]
                for a in actions
                if a["type"] == "JettonSwap" and a["status"] == "ok"
            )

            def leg(side, swap=swap):
                if swap.get("ton_" + side):
                    return TON, D(swap["ton_" + side]) / 10**9
                token = swap["jetton_master_" + side]
                return (
                    TON
                    if token.get("symbol") in ("pTON", "pGRAM")
                    else token["address"]
                ), D(swap["amount_" + side]) / 10 ** token["decimals"]

            a, qa = leg("in")
            b, qb = leg("out")
            cmds.append(
                command(
                    "swap",
                    position_id=position("main", a),
                    from_amount=str(qa),
                    to_crypto_asset_id=ref("asset", "ton", b),
                    to_amount=str(qb),
                    basis_policy="carry",
                )
            )
            paid = qa if a == TON else D(0)
            received = qb if b == TON else D(0)
        elif n == 270:
            # The payer is external: a technical transit account records the USDT
            # actually sent straight to EVAA, with zero new owner cash. Never credit main.
            add(
                "third-party-evaa:" + event["event_id"],
                when,
                int(event["lt"]) - 1,
                [reward("external_evaa", USDT, "0.000441")],
                dict(
                    accepted_evidence=external["EVAA"],
                    technical_transit="Third-party direct payment to EVAA; not a user wallet receipt",
                ),
            )
            loan = next(
                c["payload"]["position_id"]
                for r in original
                for c in r["commands"]
                if c["kind"] == "repay"
            )
            cmds.extend(
                [
                    command(
                        "accrue",
                        position_id=loan,
                        collateral_qty="0",
                        interest_qty="0.000039",
                        interest_value_in_base="0",
                        collateral_before="0.000078288",
                        debt_before="0.000402",
                        ),
                    command(
                        "repay",
                        position_id=loan,
                        source_position_id=position("external_evaa", USDT),
                        repay_qty="0.000441",
                        interest_qty="0.000039",
                        comment="Стороннее микропогашение EVAA, без собственных затрат",
                    ),
                ]
            )
            evidence["third_party_payment"] = external["EVAA"]
        else:
            for op in review["custody_operations"]:
                q = D(op["atomic"]) / 10**9
                origin = "main" if op["kind"] == "deposit" else op["custody"]
                candidates = [
                    x
                    for x in lots
                    if x["open"]
                    and x["master"] == op["master"]
                    and x["custody"] == origin
                ]
                exact = [x for x in candidates if x["quantity"] == q]
                selected = exact if len(exact) == 1 else candidates
                assert sum(x["quantity"] for x in selected) == q, (n, q, selected)
                for lot in selected:
                    dest = op["custody"] if op["kind"] == "deposit" else "main"
                    cmds.append(
                        command(
                            "lp_custody",
                            position_id=ref("protocol", lot["event_id"]),
                            receipt_master=lot["master"],
                            quantity=str(lot["quantity"]),
                            from_custody=origin,
                            to_custody=dest,
                        )
                    )
                    lot["custody"] = dest
            for a, q in net.items():
                if (
                    a != TON
                    and q > 0
                    and a in assets
                    and "LP" not in assets[a]["symbol"]
                ):
                    cmds.append(reward("main", a, q))
                elif (
                    a != TON
                    and a in assets
                    and "LP" not in assets[a]["symbol"]
                    and q < 0
                ):
                    raise ValueError((n, "unmapped outflow", a, q))
            if pton > 0:
                cmds.append(reward("main", TON, pton))
                received = pton
            elif net.get(TON, D(0)) > 0 and n in (232, 261, 274):
                received = net[TON]
                cmds.append(
                    command(
                        "receive_unknown",
                        investment_account_id=ref("account", "main"),
                        crypto_asset_id=ref("asset", "ton", TON),
                        quantity=str(received),
                        basis_assumption="owner_zero",
                        comment="Рекламное микропоступление: нулевая стоимость по разрешённому допущению",
                    )
                )
        technical = received - paid - net.get(TON, D(0))
        if technical > 0:
            cmds.append(
                command(
                    "fee", source_position_id=position("main"), quantity=str(technical)
                )
            )
        elif technical < 0:
            cmds.append(
                command(
                    "fee_refund",
                    investment_account_id=ref("account", "main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(-technical),
                    comment="Технический возврат сетевых средств",
                )
            )
        if not cmds:
            excluded_moves = [
                m for m in review["net_movements"] if m["master"] in excluded
            ]
            assert excluded_moves and all(
                m["master"] in excluded or D(m["quantity"]) == 0
                for m in review["net_movements"]
            ), n
            cmds.append(
                command(
                    "observation",
                    comment="Нежелательные токены исключены из финансового портфеля; количества сохранены в исходном журнале",
                )
            )
            evidence["excluded_token_movements"] = excluded_moves
        add(
            "main:" + event["event_id"],
            when,
            int(event["lt"]),
            cmds,
            evidence,
            event_no=n,
            expected_main={k: str(v) for k, v in running.items()},
        )
    for r in checkpoint["main_wallet_balances"]:
        assert running.get(r["master"], D(0)) == D(r["quantity"]), r
    appended.sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    for prev, row in zip(appended, appended[1:], strict=False):
        if (
            row["occurred_at"] == prev["occurred_at"]
            and row["order_in_timestamp"] <= prev["order_in_timestamp"]
        ):
            row["evidence"]["original_lt"] = row["order_in_timestamp"]
            row["order_in_timestamp"] = prev["order_in_timestamp"] + 1
    plan["rows"] += appended
    assert plan["rows"][: len(original)] == original
    assert (
        sorted(plan["rows"], key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
        == plan["rows"]
    )
    assert len({r["source_id"] for r in plan["rows"]}) == len(plan["rows"])
    plan["events"] += [
        dict(
            event_no=r["event_no"],
            event_id=r["event_id"],
            description="; ".join(econ[r["event_no"]]["notes"]),
            status="command_mapped",
            uploaded=False,
        )
        for r in reviews
    ]
    plan["inputs"] += inputs + [
        dict(
            path=str(prefix),
            sha256=hashlib.sha256(prefix.read_bytes()).hexdigest(),
            commit=None,
        )
    ]
    for name in [
        "scripts/crypto/build_third_hundred_plan.py",
        "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json",
        "outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json",
        "outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json",
    ]:
        plan["inputs"].append(
            dict(
                path=name,
                commit=None,
                sha256=hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
            )
        )
    plan["excluded_assets"] = excluded
    plan["expected_bank_RUB"] = "91655"
    plan["expected_telegram_usdt"] = "0.854082"
    plan["expected_accounts"]["telegram"].update(
        {TON: "0.412474201", USDT: "0.854082", hmstr: "1540.5763"}
    )
    plan["expected_accounts"]["telegram_yield"][hmstr] = "0"
    plan["expected_accounts"]["external_evaa"] = {USDT: "0"}
    plan["expected_accounts"]["intermediate"] = {TON: "129.435612061"}
    plan["internal_accounts"] = list(
        set(plan.get("internal_accounts", []) + ["external_evaa"])
    )
    plan["accepted_custody"] = custody["positions_after_300"]
    plan["accepted_main_after_300"] = checkpoint["main_wallet_balances"]
    plan["main_account_name"] = "История main — события 1–300"
    plan["summary"].update(
        block="0001-0300",
        total_events=300,
        total_movements=1025,
        compiled_contiguous_prefix=300,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        new_funding={"RUB": "0"},
        bank_sale_proceeds_RUB="91655",
    )
    plan["limitations"] += [
        "Third hundred uses accepted quantities, not obsolete LP 50/50 or old RUB cost vectors.",
        "Friend sale proceeds 31655/30000/30000 RUB supplied by owner supersede missing proceeds in accepted v1; bank transfer and exchange preserve basis.",
        "Telegram 0.5 TON for 2.7 USDT confirmed by owner; 2.33 USDT outflow remains unknown external destination, treated as expense.",
        "Unsolicited excluded tokens retained only in source observations, not valued portfolio assets.",
        "Third-party 0.000441 USDT EVAA payment represented through a zero-cost technical transit; settles 0.000402 principal and 0.000039 interest. No new owner fiat.",
        "EVAA residual collateral kept at last observed token quantity; 97793 protocol units are not token quantity.",
        "NexTon NFT identifies staking claim; not a duplicate asset. Carry 90 TON cost to 92.79606 TON returned.",
    ]
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    p = build(args.prefix)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(p["summary"], ensure_ascii=False))
