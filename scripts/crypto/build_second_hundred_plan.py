"""Append accepted events 101–200 to the immutable component-policy first hundred.

Only source quantities/classifications are reused; old cost vectors are not imported.
All amounts are recalculated by the application journal during dev replay.
"""

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from build_first_block_replay import PIN, TON, USDT
from build_history_inventory import ROOT, git
from compile_main_commands import ref

BASE = "crypto-task/chronological-rebuild/blocks/0101-0200/accepted/v2/"
JETTON = "0:105e5589bc66db15f13c177a12f2cf3b94881da2f4b8e7922c58569176625eb5"
D = Decimal


def command(kind, **payload):
    return dict(kind=kind, payload=payload)


def position(wallet, asset=TON):
    return ref("position", wallet, "ton", asset)


def build(prefix_path):
    plan = json.loads(prefix_path.read_text())
    original_rows = deepcopy(plan["rows"])
    inputs = []

    def accepted(name):
        raw = git("show", PIN + ":" + BASE + name)
        inputs.append(
            dict(path=BASE + name, commit=PIN, sha256=hashlib.sha256(raw).hexdigest())
        )
        return json.loads(raw)

    reviews = accepted("review.json")
    facts = accepted("protocol-facts.json")["principal_by_event"]
    funding = accepted("funding-register.json")
    custody = accepted("custody-ledger.json")
    deposit113 = accepted("JETTON-custody-113.json")
    owner_expenses = accepted("owner-external-expenses.json")
    owner_dogs = accepted("owner-DOGS-exchange.json")
    checkpoint = accepted("checkpoint.json")
    events = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json"
        ).read_text()
    )
    movements = json.loads(
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
    # Only ordinary assets enter portfolio_positions; LP receipts stay in protocols.
    for m in movements:
        if 100 < m["event_no"] <= 200 and "LP" not in m["asset"]:
            assets.setdefault(
                m["master"], dict(symbol=m["asset"], decimals=m["decimals"])
            )
    # Custodial service symbol; no on-chain contract is asserted by the source.
    dogs = "service:telegram:DOGS"
    assets.setdefault(dogs, dict(symbol="DOGS", decimals=9, network_code="telegram"))
    receipts = {r["event_no"]: r for r in funding["receipts_on_main"]}
    transfers = {
        135: D("0.05"),
        180: D("0.05"),
        191: D("0.05"),
        162: D(1),
        178: D(1),
        183: D(1),
    }
    lots = []
    for row in original_rows:
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
    balances = defaultdict(D)
    checkpoints = {}
    for m in movements:
        if m["event_no"] > 200:
            break
        balances[m["master"]] += D(m["quantity_delta"])
        checkpoints[m["event_no"]] = {k: str(v) for k, v in balances.items()}
    # Replay events atomically. Some transaction traces interleave; the original
    # per-row LT snapshot is not an event boundary. Build event-net checkpoints
    # from the accepted independent review and verify the final chain snapshot.
    running = {
        k: D(v)
        for k, v in next(
            r for r in reversed(original_rows) if r.get("event_no") == 100
        )["expected_main"].items()
    }
    for review in reviews:
        for m in review["net_movements"]:
            running[m["master"]] = running.get(m["master"], D(0)) + D(m["quantity"])
        checkpoints[review["event_no"]] = {k: str(v) for k, v in running.items()}
    for row in checkpoint["main_wallet_balances"]:
        assert running.get(row["master"], D(0)) == D(row["quantity"]), row
    appended = []

    def add(source_id, when, order, evidence, commands, **extra):
        appended.append(
            dict(
                source_id=source_id,
                occurred_at=when.astimezone(timezone.utc).isoformat(),
                accounting_date=when.astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=order,
                evidence=evidence,
                commands=commands,
                **extra,
            )
        )

    def telegram_source(row, commands, evidence=None, **extra):
        r = telegram[row]
        when = datetime.fromisoformat(
            r["date"] + "T" + (r["time_as_in_source"] or "00:00")
        ).replace(tzinfo=ZoneInfo("Europe/Moscow"))
        add(
            r["source_key"],
            when,
            row,
            dict(
                source=r,
                time_quality="minute"
                if r["time_as_in_source"]
                else "date_only_placeholder",
                **(evidence or {}),
            ),
            commands,
            **extra,
        )

    for r in funding["purchases"]:
        row = r["telegram_rows"][0]
        t = telegram[row]
        asset = TON if t["asset"] == "TON" else USDT
        quality = "estimated" if r["status"] == "owner_allowed_estimate" else "known"
        telegram_source(
            row,
            [
                command(
                    "bank_buy",
                    bank_account_id=ref("account", "primary_cash"),
                    crypto_asset_id=ref("asset", "ton", asset),
                    quantity=t["quantity"],
                    fiat_currency_code="RUB",
                    fiat_amount=r["rub"],
                    comment="Покупка Telegram"
                    + (
                        " — разрешённая оценка рублей"
                        if quality == "estimated"
                        else " — фактический платёж"
                    ),
                ),
                command(
                    "bank_to_portfolio",
                    bank_account_id=ref("account", "primary_cash"),
                    investment_account_id=ref("account", "telegram"),
                    crypto_asset_id=ref("asset", "ton", asset),
                    quantity=t["quantity"],
                    **(
                        dict(
                            purchase_quality="estimated",
                            purchase_source=BASE
                            + "funding-register.json#row="
                            + str(r["row"]),
                        )
                        if quality == "estimated"
                        else {}
                    ),
                ),
            ],
            dict(purchase=r),
            funding_RUB=r["rub"],
            funding_quality=quality,
        )

    # Preserve temporary Telegram placements as separate custody, not expenses.
    for row, asset, sender, receiver in [
        (82, TON, "telegram", "telegram_yield"),
        (85, dogs, "telegram", "telegram_yield"),
        (87, TON, "telegram_yield", "telegram"),
        (89, dogs, "telegram_yield", "telegram"),
    ]:
        telegram_source(
            row,
            [
                command(
                    "transfer",
                    position_id=position(sender, asset),
                    target_investment_account_id=ref("account", receiver),
                    amount=telegram[row]["quantity"],
                )
            ],
        )
    telegram_source(
        84,
        [
            command(
                "swap",
                position_id=position("telegram", USDT),
                from_amount="124.795918",
                to_crypto_asset_id=ref("asset", "ton", dogs),
                to_amount="100163",
                basis_policy="carry",
            )
        ],
        dict(owner_confirmation=owner_dogs),
    )
    for row in (86, 88):
        telegram_source(
            row,
            [
                command(
                    "reward",
                    investment_account_id=ref("account", "telegram"),
                    crypto_asset_id=ref("asset", "ton", dogs),
                    quantity=telegram[row]["quantity"],
                )
            ],
        )

    for review in reviews:
        n = review["event_no"]
        event = events[n - 1]
        net = {r["master"]: D(r["quantity"]) for r in review["net_movements"]}
        cmds = []
        paid = D(0)
        received = D(0)
        evidence = dict(accepted_review=review, accepted_source=BASE + "review.json")
        category = review["category"]
        if category.startswith("Обмен:"):
            swap = next(
                a["JettonSwap"]
                for a in event["raw"]["actions"]
                if a["type"] == "JettonSwap"
            )

            def leg(side, swap=swap):
                if swap.get("ton_" + side):
                    return TON, D(swap["ton_" + side]) / 10**9
                token = swap["jetton_master_" + side]
                return (
                    TON
                    if token["address"]
                    == "0:8cdc1d7640ad5ee326527fc1ad0514f468b30dc84b0173f0e155f451b4e11f7c"
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
        elif category.startswith("Внесение ликвидности:"):
            lp, qlp = next((a, q) for a, q in net.items() if q > 0 and a != TON)
            legs = [(a, -q) for a, q in net.items() if q < 0 and a != TON]
            if len(legs) == 1:
                paid = D(facts[str(n)]["TON_atomic"]) / 10**9
                legs.insert(0, (TON, paid))
            assert len(legs) == 2
            (a, qa), (b, qb) = legs
            cmds.append(
                command(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="DeDust"
                    if n in (111, 117, 155, 161, 167)
                    else "STON.fi",
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
        elif category.startswith("Фарминг:"):
            for op in review["custody_operations"]:
                q = D(op["atomic"]) / 10**9
                candidates = [
                    x
                    for x in lots
                    if x["open"]
                    and x["master"] == op["master"]
                    and x["quantity"] == q
                    and x["custody"]
                    == ("main" if op["kind"] == "deposit" else op["custody"])
                ]
                assert len(candidates) == 1, (n, candidates)
                lot = candidates[0]
                dest = op["custody"] if op["kind"] == "deposit" else "main"
                cmds.append(
                    command(
                        "lp_custody",
                        position_id=ref("protocol", lot["event_id"]),
                        receipt_master=lot["master"],
                        quantity=str(q),
                        from_custody=lot["custody"],
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
                    cmds.append(
                        command(
                            "reward",
                            investment_account_id=ref("account", "main"),
                            crypto_asset_id=ref("asset", "ton", a),
                            quantity=str(q),
                        )
                    )
        elif category.startswith("Выход из LP:"):
            lp, qlp = next((a, -q) for a, q in net.items() if a != TON and q < 0)
            selected = [
                x
                for x in lots
                if x["open"] and x["master"] == lp and x["custody"] == "main"
            ]
            assert sum(x["quantity"] for x in selected) == qlp, (n, qlp, selected)
            a, b = selected[0]["a"], selected[0]["b"]
            if TON in (a, b):
                received = D(facts[str(n)]["TON_atomic"]) / 10**9
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
        elif n == 113:
            cmds.append(
                command(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="JETTON farming",
                    position_type="staking",
                    asset_symbol="JETTON",
                    quantity=str(-net[JETTON]),
                    source_position_id=position("main", JETTON),
                    crypto_asset_id=ref("asset", "ton", JETTON),
                    network_code="ton",
                    metadata={
                        "source_event_id": event["event_id"],
                        "custody_evidence": deposit113,
                    },
                )
            )
        elif n in receipts:
            r = receipts[n]
            asset = TON if r["asset"] == "TON" else USDT
            q = D(r["quantity"])
            cmds.append(
                command(
                    "transfer",
                    position_id=position("telegram", asset),
                    target_investment_account_id=ref("account", "main"),
                    amount=str(q),
                )
            )
            if n in transfers:
                cmds.append(
                    command(
                        "fee",
                        source_position_id=position("telegram", asset),
                        quantity=str(transfers[n]),
                        comment="Разница между списанием Telegram и полученным количеством",
                    )
                )
            received = q if asset == TON else D(0)
            evidence["telegram_receipt"] = r
        elif n in (120, 122, 123):
            paid = {120: D(".1"), 122: D(".5"), 123: D(".49")}[n]
            cmds.append(
                command(
                    "expense",
                    source_position_id=position("main"),
                    quantity=str(paid),
                    comment="Владелец подтвердил внешний расход",
                )
            )
            evidence["owner_confirmation"] = owner_expenses
        elif n in (142, 143, 144):
            paid = D(1 if n == 142 else 50)
            cmds.append(
                command(
                    "transfer",
                    position_id=position("main"),
                    target_investment_account_id=ref("account", "telegram"),
                    amount=str(paid),
                )
            )
        elif review["reward_evidence"] or category.startswith(
            "Поступление сервиса JetTon"
        ):
            for a, q in net.items():
                if a != TON and q > 0:
                    cmds.append(
                        command(
                            "reward",
                            investment_account_id=ref("account", "main"),
                            crypto_asset_id=ref("asset", "ton", a),
                            quantity=str(q),
                        )
                    )
        elif n in (149, 151):
            # Accepted insignificant unsolicited receipts: no new own cash.
            for a, q in net.items():
                if q > 0:
                    cmds.append(
                        command(
                            "receive_unknown",
                            investment_account_id=ref("account", "main"),
                            crypto_asset_id=ref("asset", "ton", a),
                            quantity=str(q),
                            basis_assumption="owner_zero",
                            comment="Нежелательное микропоступление: нулевая стоимость по принятому допущению",
                        )
                    )
                    if a == TON:
                        received = q
        else:
            assert n in (
                102,
                104,
                105,
                108,
                109,
                118,
                121,
                129,
                130,
                131,
                152,
                156,
                157,
                164,
                174,
                175,
                177,
                189,
                194,
                199,
                200,
            ), n
            assert all(k == TON or q == 0 for k, q in net.items()), (n, net)
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
            assert n == 152 and all(v == 0 for v in net.values())
            cmds.append(
                command(
                    "observation",
                    comment="Нулевое сообщение: нет изменения количества или стоимости",
                )
            )
            evidence["zero_movement"] = True
        add(
            "main:" + event["event_id"],
            datetime.fromtimestamp(event["timestamp"], timezone.utc),
            int(event["lt"]),
            evidence,
            cmds,
            event_no=n,
            expected_main=checkpoints[n],
        )

    appended.sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    for previous, row in zip(appended, appended[1:], strict=False):
        if (
            row["occurred_at"] == previous["occurred_at"]
            and row["order_in_timestamp"] <= previous["order_in_timestamp"]
        ):
            row["evidence"]["original_lt"] = row["order_in_timestamp"]
            row["evidence"]["ordering_note"] = (
                "Shared source timestamp/LT; stable accepted event order tie-break"
            )
            row["order_in_timestamp"] = previous["order_in_timestamp"] + 1
    # One USDT rounding shortfall inherited from nominal two-decimal purchases.
    usdt = D(plan["expected_telegram_usdt"])
    corrections = []
    for row in appended:
        for i, c in enumerate(list(row["commands"])):
            p = c["payload"]
            q = D(0)
            if c["kind"] == "bank_to_portfolio" and p["crypto_asset_id"] == ref(
                "asset", "ton", USDT
            ):
                usdt += D(p["quantity"])
            elif c["kind"] in ("transfer", "fee", "swap") and p.get(
                "position_id", p.get("source_position_id")
            ) == position("telegram", USDT):
                q = D(p.get("amount", p.get("quantity", p.get("from_amount", "0"))))
            if q > usdt:
                gap = q - usdt
                assert gap <= D(".1"), (row["source_id"], gap)
                correction = dict(
                    source_id=row["source_id"],
                    quantity=str(gap),
                    asset="USDT",
                    reason="nominal rounded Telegram quantities; no new cash",
                )
                corrections.append(correction)
                row["evidence"]["quantity_correction"] = correction
                row["commands"].insert(
                    i,
                    command(
                        "quantity_correction",
                        investment_account_id=ref("account", "telegram"),
                        crypto_asset_id=ref("asset", "ton", USDT),
                        quantity=str(gap),
                        comment="Малая поправка округления Telegram; без новых затрат",
                    ),
                )
                usdt += gap
            usdt -= q
    plan["events"] += [
        dict(
            event_no=r["event_no"],
            event_id=r["event_id"],
            description=r["category"],
            status="command_mapped",
            uploaded=False,
        )
        for r in reviews
    ]
    plan["rows"] += appended
    assert plan["rows"][: len(original_rows)] == original_rows
    assert len({r["source_id"] for r in plan["rows"]}) == len(plan["rows"])
    assert (
        sorted(plan["rows"], key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
        == plan["rows"]
    )
    for name in (
        "scripts/crypto/build_second_hundred_plan.py",
        "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json",
        "outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json",
        "outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json",
    ):
        inputs.append(
            dict(
                path=name,
                commit=None,
                sha256=hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
            )
        )
    plan["inputs"] += inputs
    plan["inputs"].append(
        dict(
            path=str(prefix_path),
            sha256=hashlib.sha256(prefix_path.read_bytes()).hexdigest(),
            commit=None,
        )
    )
    plan["expected_telegram_usdt"] = str(usdt)
    plan["expected_accounts"] = {
        "telegram": {TON: "0.912474201", USDT: str(usdt), dogs: "103993.0468"},
        "telegram_yield": {TON: "0", dogs: "0"},
    }
    plan["main_account_name"] = "История main — события 1–200"
    plan["accepted_custody_after_200"] = custody["positions_after_200"]
    plan["accepted_main_after_200"] = checkpoint["main_wallet_balances"]
    plan["quantity_corrections"] += corrections
    plan["summary"].update(
        block="0001-0200",
        total_events=200,
        total_movements=649,
        compiled_contiguous_prefix=200,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan["summary"].pop("reference_valued_swaps", None)
    plan["summary"]["new_funding"] = funding["new_service_purchases_RUB"]
    plan["limitations"] += [
        "Three Telegram RUB purchases use previously owner-accepted estimates: 176919.34 RUB, not confirmed bank payments.",
        "Second hundred: source nominal rounding correction explicitly recorded; withdrawal differences expensed.",
        "LP proceeds distributed to original deposits by receipt share, then net-composition policy per deposit.",
        "EVAA dust kept at last observed first-hundred index; future tail settlement is not backdated.",
        "Main event checkpoints follow grouped event movements; interleaved transactions are audited at their combined boundary.",
    ]
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = build(args.prefix)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], ensure_ascii=False))
