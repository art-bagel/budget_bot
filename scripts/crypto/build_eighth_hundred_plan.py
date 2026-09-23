"""Compile events 701-743 from pinned quantities, carrying cash and funding units."""

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal as D
from fractions import Fraction
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from build_first_block_replay import PIN, TON, USDT
from build_history_inventory import ROOT, git
from build_second_hundred_plan import JETTON, command as C, position as P
from compile_main_commands import ref
from verify_evaa_liquidations import verify as verify_liquidation

BASE = "crypto-task/chronological-rebuild/blocks/0701-0800/accepted/v1/"
MAIN = "0:29ee71155245d272af9946305e8f21959eff23a07582ebbda39d47fd8383decf"
COLD = "0:a52881caeb14f2139c17697363edd9979265c6a9ba7175b0dbe275a53fa9199e"
GROUP = "0:3c9582af5fbfac15b6658dcd85b037c05de95bd795f1f70323a48992f22c61aa"
SECOND = "0:19319d134089d0bda19af8c2c350b283f97cf827ca710363d90d49ebcd738f75"


def build(prefix):
    plan = json.loads(prefix.read_text())
    original = deepcopy(plan["rows"])
    inputs = []
    added = []

    def read(path, pinned=True):
        raw = git("show", PIN + ":" + path) if pinned else (ROOT / path).read_bytes()
        inputs.append(
            dict(
                path=path,
                commit=PIN if pinned else None,
                sha256=hashlib.sha256(raw).hexdigest(),
            )
        )
        return json.loads(raw)

    events = read(
        "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json", False
    )
    ledger = read(BASE + "ledger.json")
    reviews = read(BASE + "economic-review.json")
    bybit = read(
        "outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json", False
    )
    byend = read(BASE + "bybit-cost-continuation.json")
    servers = {x["event_no"]: x for x in read(BASE + "server-purchases.json")}
    ledger = [x for x in ledger if x["event_no"] <= 743]
    reviews = [x for x in reviews if x["event_no"] <= 743]
    assets = plan["assets"]
    excluded = plan["excluded_assets"]
    net = defaultdict(lambda: defaultdict(D))
    symbols = {v["symbol"]: k for k, v in assets.items()}
    for m in ledger:
        net[m["event_no"]][m["master"]] += D(m["delta_atomic"]) / 10 ** m["decimals"]
        if m.get("excluded_from_financial_perimeter"):
            excluded[m["master"]] = dict(symbol=m["asset"], reason="accepted exclusion")
        elif "LP" not in m["asset"] or m["asset"] == "TON-SLP":
            assets.setdefault(
                m["master"], dict(symbol=m["asset"], decimals=m["decimals"])
            )
            symbols[m["asset"]] = m["master"]

    def dt(t):
        return datetime.fromtimestamp(t, timezone.utc) if isinstance(t, int) else t

    def add(sid, t, cmds, evidence, order=0, **extra):
        t = dt(t)
        added.append(
            dict(
                source_id=sid,
                occurred_at=t.isoformat(),
                accounting_date=t.astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=order,
                commands=cmds,
                evidence=evidence,
                **extra,
            )
        )

    def transfer(w, to, a, q):
        return C(
            "transfer",
            position_id=P(w, a),
            target_investment_account_id=ref("account", to),
            amount=str(q),
        )

    def fee(w, a, q):
        return C("fee", source_position_id=P(w, a), quantity=str(q))

    def reward(w, a, q):
        return C(
            "reward",
            investment_account_id=ref("account", w),
            crypto_asset_id=ref("asset", "ton", a),
            quantity=str(q),
        )

    def swap(w, a, q, b, r):
        return C(
            "swap",
            position_id=P(w, a),
            from_amount=str(q),
            to_crypto_asset_id=ref("asset", "ton", b),
            to_amount=str(r),
            basis_policy="carry",
        )

    def proto(n):
        return ref("protocol", events[n - 1]["event_id"])

    start = events[699]["timestamp"]
    finish = events[742]["timestamp"]
    # Exchange custody/trading is a hidden calculation boundary; withdrawals to Ethereum retain basis.
    eth = "service:bybit:ETH"
    assets[eth] = dict(symbol="ETH", decimals=18, network_code="ethereum")
    keys = {"TON": TON, "USDT": USDT, "ETH": eth}
    groups = defaultdict(list)
    for r in bybit:
        t = datetime.fromisoformat(r["Дата"] + "T" + r["Время"]).replace(
            tzinfo=timezone.utc
        )
        if dt(start) < t <= dt(finish):
            groups[t].append(r)
    card = read(
        "outputs/crypto-card-valuations-2026-09-23/result-v1/valued-card-conversions.json",
        False,
    )
    for t, rs in sorted(groups.items()):
        trades = [r for r in rs if r["Тип"] == "TRADE"]
        if trades:
            sums = defaultdict(D)
            for r in trades:
                sums[r["Актив"]] += D(r["Изменение"].replace(",", "."))
            neg = [(a, -q) for a, q in sums.items() if q < 0]
            pos = [(a, q) for a, q in sums.items() if q > 0]
            assert len(neg) == len(pos) == 1, (t, sums)
            a, q = neg[0]
            b, r = pos[0]
            add(
                "bybit:trades:" + t.isoformat(),
                t,
                [swap("exchange_source", keys[a], q, keys[b], r)],
                dict(source_rows=trades),
                max(r["_source_line"] for r in trades),
            )
        for r in rs:
            a = keys.get(r["Актив"])
            q = D(r["Изменение"].replace(",", "."))
            kind = r["Тип"]
            line = r["_source_line"]
            cmds = []
            extra = {}
            if not a:
                continue
            if kind == "Fiat":
                rub = D(r["₽"].replace(",", "."))
                cmds = [
                    C(
                        "bank_buy",
                        bank_account_id=ref("account", "primary_cash"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=str(q),
                        fiat_currency_code="RUB",
                        fiat_amount=str(rub),
                    ),
                    C(
                        "bank_to_portfolio",
                        bank_account_id=ref("account", "primary_cash"),
                        investment_account_id=ref("account", "exchange_source"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=str(q),
                    ),
                ]
                extra = dict(funding_RUB=str(rub), funding_quality="known")
            elif q > 0 and (
                kind == "Airdrop"
                or kind == "Earn"
                and "Interest Distribution" in r["Описание"]
            ):
                cmds = [reward("exchange_source", a, q)]
            elif kind == "Withdraw" and a == eth:
                # Export includes gross amount and the withdrawal fee; preserve full gross basis
                # at the Ethereum boundary until its own chain reconstruction separates the fee.
                cmds = [transfer("exchange_source", "ethereum_boundary", a, -q)]
            elif kind == "Bybit Card" and q < 0:
                v = next(v for v in card if line in v["source_lines"])
                if line != min(
                    x["_source_line"]
                    for x in rs
                    if x["Тип"] == "Bybit Card"
                    and x["Актив"] == r["Актив"]
                    and x["_source_line"] in v["source_lines"]
                ):
                    continue
                card_quantity = v["crypto_debits"][r["Актив"]]
                cmds = [
                    C(
                        "sell_fiat",
                        investment_account_id=ref("account", "exchange_source"),
                        bank_account_id=ref("account", "primary_cash"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=card_quantity,
                        fiat_currency_code="USD",
                        fiat_amount=v["pending_manual_amount"],
                        historical_value_in_base=v["historical_value_in_base"],
                        valuation_source="Bybit export and prepared historical CBR rate",
                        defer_manual_expense=True,
                    )
                ]
            if cmds:
                add("bybit:row:" + str(line), t, cmds, dict(source=r), line, **extra)
    side_refunds = read(BASE + "external-refund-links.json")
    side_sent = {x["sent"]: x for x in side_refunds}
    side_returned = {x["returned"]: x for x in side_refunds}
    side_final = {}
    for w, address in [("cold", COLD), ("second", SECOND)]:
        cache = read("outputs/crypto-fifth-block-dev/sources/" + w + ".json", False)
        # Independent quantity checkpoint from the side wallet's complete cached history.
        balance = defaultdict(D)
        for event in cache["events"]:
            if event["timestamp"] > finish:
                continue
            balance[TON] += D(event["extra"]) / 10**9
            for action in event["actions"]:
                if action["status"] != "ok":
                    continue
                if action["type"] == "TonTransfer":
                    transfer_data = action["TonTransfer"]
                    asset, quantity = TON, D(transfer_data["amount"]) / 10**9
                elif action["type"] == "JettonTransfer":
                    transfer_data = action["JettonTransfer"]
                    asset = transfer_data["jetton"]["address"]
                    quantity = D(transfer_data["amount"]) / 10 ** int(
                        transfer_data["jetton"]["decimals"]
                    )
                else:
                    continue
                if transfer_data.get("sender", {}).get("address") == address:
                    balance[asset] -= quantity
                if transfer_data.get("recipient", {}).get("address") == address:
                    balance[asset] += quantity
        side_final[w] = {
            asset: str(quantity)
            for asset, quantity in balance.items()
            if asset in assets
        }
        for e in cache["events"]:
            if not start < e["timestamp"] <= finish:
                continue
            cmds = []
            for a in e["actions"]:
                if a["type"] != "TonTransfer" or a["status"] != "ok":
                    continue
                z = a["TonTransfer"]
                sender = z["sender"]["address"]
                recipient = z["recipient"]["address"]
                q = D(z["amount"]) / 10**9
                if not q:
                    continue
                if sender == recipient:
                    continue
                if MAIN in (sender, recipient):
                    continue
                if sender in (COLD, SECOND) and recipient in (COLD, SECOND):
                    if sender == address:
                        cmds.append(
                            transfer(
                                w, "second" if recipient == SECOND else "cold", TON, q
                            )
                        )
                    continue
                if recipient == address and q <= D("0.001"):
                    cmds.append(reward(w, TON, q))
                    continue
                pair = side_sent.get(e["event_id"]) or side_returned.get(e["event_id"])
                if pair:
                    assert pair["wallet"] == w and D(pair["amount_atomic"]) / 10**9 == q
                    boundary = "sticker_refund_" + pair["sent"][:16]
                    cmds.append(
                        transfer(
                            w if sender == address else boundary,
                            boundary if sender == address else w,
                            TON,
                            q,
                        )
                    )
                elif GROUP in (sender, recipient):
                    cmds.append(
                        transfer(
                            "shared_claim" if sender == GROUP else w,
                            w if sender == GROUP else "shared_claim",
                            TON,
                            q,
                        )
                    )
                elif sender == address:
                    cmds.append(transfer(w, "gifts", TON, q))
                elif recipient == address:
                    cmds.append(dict(gift_return=dict(wallet=w, quantity=str(q))))
            extra = D(e["extra"]) / 10**9
            if extra < 0:
                cmds.append(fee(w, TON, -extra))
            elif extra > 0:
                cmds.append(reward(w, TON, extra))
            if cmds:
                add(
                    "own:" + w + ":" + e["event_id"],
                    e["timestamp"],
                    cmds,
                    dict(source=e),
                    int(e["lt"]) + 1,
                )

    loans = {
        int(k): {a: D(v) for a, v in x.items()}
        for k, x in plan["expected_evaa"].items()
    }
    liquidation_links = {
        x["event_no"]: x
        for x in read(BASE + "evaa-evidence-links.json")
        if x["kind"] == "liquidation"
    }
    running = {
        k: D(v)
        for k, v in next(r for r in reversed(original) if "expected_main" in r)[
            "expected_main"
        ].items()
    }
    receipts = {int(k): v for k, v in byend["receipts"].items()}
    for n in range(701, 744):
        ev = events[n - 1]
        v = net[n]
        cmds = []
        paid = received = D(0)
        evidence = dict(accepted_review=reviews[n - 701])
        t, order = ev["timestamp"], int(ev["lt"])
        for a, q in v.items():
            running[a] = running.get(a, D(0)) + q
        if n in receipts:
            rr = receipts[n]
            a = keys[rr["asset"]]
            q = D(Fraction(rr["received"]).numerator) / D(
                Fraction(rr["received"]).denominator
            )
            match = [
                r
                for r in bybit
                if r["Тип"] == "Withdraw"
                and r["Актив"] == rr["asset"]
                and abs(
                    (
                        datetime.fromisoformat(r["Дата"] + "T" + r["Время"]).replace(
                            tzinfo=timezone.utc
                        )
                        - dt(t)
                    ).total_seconds()
                )
                < 600
            ]
            assert len(match) == 1, (n, match)
            gross = -D(match[0]["Изменение"].replace(",", "."))
            cmds = [
                transfer("exchange_source", "main", a, q),
                fee("exchange_source", a, gross - q),
            ]
            received = q if a == TON else D(0)
        elif n in servers:
            purchase = servers[n]
            quantity = D(str(purchase["quantity_TON"]))
            rub = D(str(purchase["fiat_paid_RUB"]))
            action = ev["raw"]["actions"][0]["TonTransfer"]
            assert action["sender"]["address"] == GROUP
            assert action["recipient"]["address"] == MAIN
            assert D(action["amount"]) / 10**9 == quantity
            received = quantity
            cmds = [
                C(
                    "bank_buy",
                    bank_account_id=ref("account", "primary_cash"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(quantity),
                    fiat_currency_code="RUB",
                    fiat_amount=str(rub),
                ),
                C(
                    "bank_to_portfolio",
                    bank_account_id=ref("account", "primary_cash"),
                    investment_account_id=ref("account", "main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(quantity),
                ),
            ]
            evidence["server_purchase"] = purchase
        elif n in liquidation_links:
            z = verify_liquidation(
                liquidation_links[n],
                read(f"outputs/evaa-liquidation-history/trace-{n}.json", False),
            )
            root = 443 if n == 740 else 330
            loan = loans[root]
            coll_before, debt_before = D(z["collateral_before"]), D(z["debt_before"])
            # Earlier snapshots contain a three-nanoton floor residue on TON-SLP.
            # Consume it explicitly with the liquidation instead of negative accrual.
            rounding = max(D(0), loan["coll"] - coll_before)
            assert rounding <= D("0.000000003"), (n, rounding)
            coll_before = max(coll_before, loan["coll"])
            assert debt_before >= loan["debt"]
            cmds = [
                C(
                    "accrue",
                    position_id=proto(root),
                    collateral_qty=str(coll_before - loan["coll"]),
                    interest_qty=str(debt_before - loan["debt"]),
                    interest_value_in_base="0",
                    collateral_before=str(loan["coll"]),
                    debt_before=str(loan["debt"]),
                )
            ]
            reduction = D(z["debt_removed"])
            interest = (
                reduction * (debt_before - loan["body"]) / debt_before
            ).quantize(D("0.000001"))
            cmds.append(
                C(
                    "liquidate",
                    position_id=proto(root),
                    collateral_qty=str(coll_before - D(z["collateral_after"])),
                    debt_qty=str(reduction),
                    interest_qty=str(interest),
                    collateral_fee_qty="0",
                    comment="EVAA: изъятие залога и погашение долга; отдельный штраф не установлен",
                )
            )
            loan.update(
                coll=D(z["collateral_after"]),
                debt=D(z["debt_after"]),
                body=loan["body"] - reduction + interest,
            )
            received = D(ev["raw"]["actions"][0]["TonTransfer"]["amount"]) / 10**9
            cmds.append(reward("main", TON, received))
            evidence.update(
                liquidation=z,
                collateral_rounding_correction=str(rounding),
                penalty_quality="unknown; zero parameter is not a confirmed zero penalty",
            )
        elif n == 721:
            paid = D(22)
            assert (
                ev["raw"]["actions"][0]["SmartContractExec"]["ton_attached"]
                == 22 * 10**9
            )
            evidence["nft_evidence"] = read(BASE + "nft-721.json")
            cmds = [transfer("main", "gifts", TON, paid)]
        elif n == 723:
            paid = D("0.100554713")
            actions = ev["raw"]["actions"]
            assert actions[0]["SmartContractExec"]["ton_attached"] == 1200000000
            assert (
                sum(
                    x["TonTransfer"]["amount"]
                    for x in actions
                    if x["type"] == "TonTransfer"
                    and x["TonTransfer"]["recipient"]["address"] == MAIN
                )
                == 1099445287
            )
            cmds = [
                C(
                    "expense",
                    source_position_id=P("main"),
                    quantity=str(paid),
                    comment="Операция коллекции NFT, за вычетом возврата",
                )
            ]
        elif n in (725, 726, 728):
            cmds = [reward("main", JETTON, v[JETTON])]
            if n in (726, 728):
                paid = D("0.0725")
                # Isolate the specific call to return its original cost in 727/729.
                boundary = "service_call_" + str(n)
                cmds.append(transfer("main", boundary, TON, paid))
        elif n in (727, 729):
            received = D("0.0596")
            boundary = "service_call_" + str(n - 1)
            cmds = [
                transfer(boundary, "main", TON, received),
                C(
                    "expense",
                    source_position_id=P(boundary),
                    quantity="0.0129",
                    comment="Сервисный вызов за вычетом возврата",
                ),
            ]
        elif ev["raw"]["actions"][0]["type"] == "JettonSwap":
            z = ev["raw"]["actions"][0]["JettonSwap"]
            a = z["jetton_master_in"]["address"]
            q = D(z["amount_in"]) / 10 ** int(z["jetton_master_in"]["decimals"])
            received = D(z["ton_out"]) / 10**9
            cmds = [swap("main", a, q, TON, received)]
        else:
            actions = ev["raw"]["actions"]
            assert len(actions) == 1 and actions[0]["type"] == "TonTransfer", n
            z = actions[0]["TonTransfer"]
            q = D(z["amount"]) / 10**9
            sender, recipient = z["sender"]["address"], z["recipient"]["address"]
            incoming = recipient == MAIN
            if sender == recipient == MAIN:
                evidence["self_transfer"] = "Principal unchanged"
            else:
                if incoming:
                    received = q
                else:
                    paid = q
                if SECOND in (sender, recipient) or COLD in (sender, recipient):
                    w = "second" if SECOND in (sender, recipient) else "cold"
                    cmds = [
                        transfer(
                            w if incoming else "main", "main" if incoming else w, TON, q
                        )
                    ]
                elif GROUP in (sender, recipient):
                    cmds = [
                        transfer(
                            "shared_claim" if incoming else "main",
                            "main" if incoming else "shared_claim",
                            TON,
                            q,
                        )
                    ]
                elif incoming and q <= D("0.001"):
                    cmds = [reward("main", TON, q)]
                    evidence["micro_assumption"] = (
                        "Zero new own-money cost; address not identified as own"
                    )
                elif (
                    "Telegram Stars" in z.get("comment", "")
                    or n == 724
                    or n <= 715
                    or n == 732
                ):
                    if n <= 715 or n == 732:
                        assert q == D("0.03")
                    cmds = [
                        C(
                            "expense",
                            source_position_id=P("main"),
                            quantity=str(q),
                            comment="Telegram Stars"
                            if n == 738
                            else "Малый сервисный платёж",
                        )
                    ]
                elif incoming:
                    raise AssertionError(("Unmapped main receipt", n))
                    cmds = [dict(gift_return=dict(wallet="main", quantity=str(q)))]
                else:
                    cmds = [transfer("main", "gifts", TON, q)]
        technical = received - paid - v.get(TON, D(0))
        if technical > 0:
            cmds.append(fee("main", TON, technical))
        elif technical < 0:
            cmds.append(
                C(
                    "fee_refund",
                    investment_account_id=ref("account", "main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(-technical),
                )
            )
        add(
            "main:" + ev["event_id"],
            t,
            cmds,
            evidence,
            order,
            **(
                dict(
                    funding_RUB=str(servers[n]["fiat_paid_RUB"]),
                    funding_quality="known",
                )
                if n in servers
                else {}
            ),
            event_no=n,
            expected_main={k: str(q) for k, q in running.items()},
        )
    # Service returns carry the weighted historical pool; excess withdrawals are explicit unknowns.
    added.sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    # One chain event can occur in two wallet-local feeds with the same LT.
    # Keep both gas records and a unique stable posting order; principal is emitted once.
    previous_time, previous_order = None, -1
    for row in added:
        if (
            row["occurred_at"] == previous_time
            and row["order_in_timestamp"] <= previous_order
        ):
            row["order_in_timestamp"] = previous_order + 1
        previous_time, previous_order = row["occurred_at"], row["order_in_timestamp"]
    gifts = D(plan["expected_accounts"]["gifts"][TON])
    for r in added:
        out = []
        for c in r["commands"]:
            if "gift_return" in c:
                g = c["gift_return"]
                q = D(g["quantity"])
                assert gifts >= q, (
                    "gift service requires earlier funding",
                    r["source_id"],
                    gifts,
                    q,
                )
                out.append(transfer("gifts", g["wallet"], TON, q))
                gifts -= q
            else:
                if c["kind"] == "transfer" and c["payload"][
                    "target_investment_account_id"
                ] == ref("account", "gifts"):
                    gifts += D(c["payload"]["amount"])
                out.append(c)
        r["commands"] = out
    plan["rows"] += added
    assert plan["rows"][: len(original)] == original
    assert plan["rows"] == sorted(
        plan["rows"], key=lambda r: (r["occurred_at"], r["order_in_timestamp"])
    )
    plan["events"] += [
        dict(
            event_no=r["event_no"],
            event_id=r["event_id"],
            description=r["explanation"],
            status="command_mapped",
            uploaded=False,
        )
        for r in reviews
    ]
    plan["expected_accounts"].update(side_final)
    shared = D(plan["expected_accounts"]["shared_claim"][TON])
    for row in added:
        for c in row["commands"]:
            if c["kind"] != "transfer":
                continue
            p = c["payload"]
            if p["target_investment_account_id"] == ref("account", "shared_claim"):
                shared += D(p["amount"])
            if p["position_id"] == P("shared_claim"):
                shared -= D(p["amount"])
    plan["expected_accounts"]["shared_claim"] = {TON: str(shared)}
    # Independently sum raw exchange deltas from the accepted opening balance.
    balances = {
        k: D(v) for k, v in plan["expected_accounts"]["exchange_source"].items()
    }
    for rs in groups.values():
        for r in rs:
            if r["Актив"] in keys:
                balances[keys[r["Актив"]]] = balances.get(keys[r["Актив"]], D(0)) + D(
                    r["Изменение"].replace(",", ".")
                )
    plan["expected_accounts"]["exchange_source"] = {
        k: str(v) for k, v in balances.items()
    }
    plan["expected_accounts"]["gifts"] = {TON: str(gifts)}
    plan["expected_evaa"] = loans
    plan["main_account_name"] = "История main — события 1–743"
    plan["expected_bank_USD"] = str(
        sum(
            D(c["payload"]["fiat_amount"])
            for row in plan["rows"]
            for c in row["commands"]
            if c["kind"] == "sell_fiat" and c["payload"]["fiat_currency_code"] == "USD"
        )
    )
    plan["summary"]["bank_sale_proceeds_RUB"] = plan["expected_bank_RUB"]
    plan["summary"]["new_funding"] = {
        "RUB": str(sum(D(r.get("funding_RUB", "0")) for r in added))
    }
    plan["summary"].update(
        block="0001-0743",
        total_events=743,
        total_movements=plan["summary"]["total_movements"] + len(ledger),
        compiled_contiguous_prefix=743,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan["limitations"] += [
        "Partial eighth block through 743; later collateral changes and unknown-cost Arbitrum return are not posted; not closed through 800.",
        "3.595 TON on second remains a probable gift-service return, carrying pooled cost.",
    ]
    plan["summary"]["first_unimplemented_event"] = 744
    plan["summary"]["first_unimplemented_kind"] = (
        "Collateral top-ups and unresolved Ethereum cost boundary"
    )
    plan["inputs"] += inputs + [
        dict(path=str(prefix), sha256=hashlib.sha256(prefix.read_bytes()).hexdigest())
    ]
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    result = build(a.prefix)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n"
    )
    print(result["summary"])
