"""Compile events 701-800 from pinned quantities, carrying cash and funding units."""

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
from verify_evaa_liquidations import (
    verify as verify_liquidation,
    command as decode,
    nodes,
    boc,
    Bits,
    dictionary,
)
from audit_evaa_accounts import MASTER_B, USER_A, USER_B

BASE = "crypto-task/chronological-rebuild/blocks/0701-0800/accepted/v1/"
MAIN = "0:29ee71155245d272af9946305e8f21959eff23a07582ebbda39d47fd8383decf"
COLD = "0:a52881caeb14f2139c17697363edd9979265c6a9ba7175b0dbe275a53fa9199e"
GROUP = "0:3c9582af5fbfac15b6658dcd85b037c05de95bd795f1f70323a48992f22c61aa"
SECOND = "0:19319d134089d0bda19af8c2c350b283f97cf827ca710363d90d49ebcd738f75"


def build(prefix, end=800):
    assert 746 <= end <= 800
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
    ledger = [x for x in ledger if x["event_no"] <= end]
    reviews = [x for x in reviews if x["event_no"] <= end]
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
    finish = events[end - 1]["timestamp"]
    # Exchange custody/trading is a hidden calculation boundary; withdrawals to Ethereum retain basis.
    eth = "service:bybit:ETH"
    assets[eth] = dict(symbol="ETH", decimals=18, network_code="ethereum")
    usdc = "service:bybit:USDC"
    assets[usdc] = dict(symbol="USDC", decimals=6, network_code="arbitrum")
    keys = {"TON": TON, "USDT": USDT, "ETH": eth, "USDC": usdc}
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
    nominator_root = None
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
                nominator = (
                    "0:456db482ac09d7d9758e8d2ab6aa7031fc645dc76c19205aab964f43d3ed66c4"
                )
                if w == "cold" and nominator in (sender, recipient):
                    if sender == nominator:
                        continue  # Return netted against the 0.2 TON service deposit below.
                    accepted = q - D("0.2")
                    back = sum(
                        D(a["TonTransfer"]["amount"]) / 10**9
                        for a in e["actions"]
                        if a["type"] == "TonTransfer"
                        and a["TonTransfer"]["sender"]["address"] == nominator
                    )
                    assert any(
                        a.get("TonTransfer", {}).get("comment")
                        == f"Stake {accepted:.9f} accepted"
                        for a in e["actions"]
                    )
                    if nominator_root is None:
                        nominator_root = e["event_id"]
                        cmds.append(
                            C(
                                "create_protocol",
                                investment_account_id=ref("account", "cold"),
                                protocol_name="TON Nominator",
                                position_type="staking",
                                asset_symbol="TON",
                                quantity=str(accepted),
                                source_position_id=P("cold"),
                                crypto_asset_id=ref("asset", "ton", TON),
                                network_code="ton",
                                metadata=dict(source_event_id=nominator_root),
                            )
                        )
                    else:
                        cmds.append(
                            C(
                                "top_up_protocol",
                                position_id=ref("protocol", nominator_root),
                                source_position_id=P("cold"),
                                quantity=str(accepted),
                            )
                        )
                    cmds.append(fee("cold", TON, D("0.2") - back))
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

    # Decode historical EVAA request rates + the successful response principal.
    def evaa(n):
        trace = read(f"outputs/crypto-eighth-block-dev/sources/trace-{n}.json", False)
        assert trace.get("emulated") is False
        ts = [z["transaction"] for z in nodes(trace)]
        for tx in ts:
            if tx["account"]["address"] not in (USER_A, USER_B):
                continue
            try:
                cells, b, version, upgrade, op, query = decode(tx["in_msg"]["raw_body"])
            except (AssertionError, KeyError):
                continue
            if op == 0x41:
                rates = {
                    k: (r.u(64), r.u(64))
                    for k, r in dictionary(
                        cells, cells[cells[0][1][upgrade + 2]][1][1], 256
                    )
                }
                reply = next(
                    t for t in ts if t["in_msg"].get("op_code") == "0x00000411"
                )
                rc = boc(reply["in_msg"]["raw_body"])
                rb = Bits(rc[rc[0][1][1]][0])
                actual, asset = rb.u(64), rb.u(256)
                assert rb.address() == MAIN
                after, borrowed, reclaimed = rb.i(64), rb.i(64), rb.i(64)
                assert borrowed == 0 and reply["success"] and tx["success"]
                return dict(
                    before=after + reclaimed,
                    after=after,
                    actual=actual,
                    supply=rates[asset][0],
                    borrow=rates[asset][1],
                    op=op,
                    asset=asset,
                    transaction=tx["hash"],
                    user=tx["account"]["address"],
                )
            if op not in (0x11, 0x21):
                continue
            assert tx["success"] and not tx["aborted"]
            asset, amount, supply, borrow = b.u(256), b.u(64), b.u(64), b.u(64)
            reply = next(
                t
                for t in ts
                if t["in_msg"].get("op_code")
                == ("0x0000011a" if op == 17 else "0x00000211")
                and t["in_msg"]["source"]["address"] == tx["account"]["address"]
            )
            rb = Bits(boc(reply["in_msg"]["raw_body"])[0][0])
            assert rb.u(32) == (0x11A if op == 17 else 0x211) and rb.u(64) == query
            assert rb.address() == MAIN and rb.u(256) == asset
            actual = rb.u(64)
            after = rb.i(64)
            first = rb.i(64)
            second = rb.i(64)
            before = after - first - second if op == 17 else after + second - first
            assert reply["success"] and not reply["aborted"]
            return dict(
                before=before,
                after=after,
                amount=amount,
                actual=actual,
                supply=supply,
                borrow=borrow,
                op=op,
                asset=asset,
                transaction=tx["hash"],
                user=tx["account"]["address"],
            )
        raise AssertionError(n)

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
    for n in range(701, end + 1):
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
        elif n in (745, 746):
            z = evaa(n)
            link = next(
                x for x in read(BASE + "evaa-evidence-links.json") if x["event_no"] == n
            )
            assert z["user"] == (USER_A if n == 745 else USER_B)
            assert z["op"] == 17
            assert z["before"] == link["principal_before"]
            assert z["after"] == link["principal_after"]
            assert z["actual"] == link["amount_atomic"]
            q = D(z["actual"]) / 10**9
            after = D(z["after"] * z["supply"] // 10**12) / 10**9
            if n == 745:
                before = after - q
                assert before >= loans[330]["coll"]
                cmds = [
                    C(
                        "accrue",
                        position_id=proto(330),
                        collateral_qty=str(before - loans[330]["coll"]),
                        interest_qty="0",
                        interest_value_in_base="0",
                        collateral_before=str(loans[330]["coll"]),
                        debt_before=str(loans[330]["debt"]),
                    ),
                    C(
                        "top_up_protocol",
                        position_id=proto(330),
                        source_position_id=P("main"),
                        quantity=str(q),
                    ),
                ]
                loans[330]["coll"] = after
            else:
                assert z["before"] == 0 and abs(after - q) <= D("0.000000001")
                cmds = [
                    C(
                        "create_protocol",
                        investment_account_id=ref("account", "main"),
                        protocol_name="EVAA",
                        position_type="lending",
                        asset_symbol="TON",
                        quantity=str(q),
                        source_position_id=P("main"),
                        crypto_asset_id=ref("asset", "ton", TON),
                        network_code="ton",
                        metadata=dict(
                            source_event_id=ev["event_id"],
                            lending_account_key=MASTER_B + "/" + USER_B,
                            lending_master_contract=MASTER_B,
                            lending_user_contract=USER_B,
                        ),
                    )
                ]
                # Contract flooring can differ by one nano; retain the deposited quantity.
                loans[746] = dict(coll=q)
            paid = q
            evidence["evaa"] = z
        elif n in (750, 751, 757, 758, 761, 762, 777, 781, 790):
            z = evaa(n)
            link = next(
                x for x in read(BASE + "evaa-evidence-links.json") if x["event_no"] == n
            )
            assert (
                z["before"] == link["principal_before"]
                and z["after"] == link["principal_after"]
            )
            assert z["actual"] == link["amount_atomic"]
            root = 746 if z["user"] == USER_B else 330
            x = loans[root]
            q = D(z["actual"]) / 10**9
            after = D(z["after"] * z["supply"] // 10**12) / 10**9
            before = after - q if z["op"] == 17 else after + q
            assert before >= x["coll"]
            cmds = [
                C(
                    "accrue",
                    position_id=proto(root),
                    collateral_qty=str(before - x["coll"]),
                    interest_qty="0",
                    interest_value_in_base="0",
                    collateral_before=str(x["coll"]),
                    debt_before=str(x.get("debt", 0)),
                )
            ]
            if z["op"] == 17:
                paid = q
                cmds.append(
                    C(
                        "top_up_protocol",
                        position_id=proto(root),
                        source_position_id=P("main"),
                        quantity=str(q),
                    )
                )
            else:
                received = q
                cmds.append(
                    C(
                        "partial_close_protocol",
                        position_id=proto(root),
                        principal_qty=str(q),
                    )
                )
            x["coll"] = after
            evidence["evaa"] = z
        elif n == 796:
            assert ev["raw"]["actions"][0]["type"] == "NftItemTransfer"
            evidence["own_nft_transfer"] = True
        elif n in (766, 768):
            z = ev["raw"]["actions"][0]["TonTransfer"]
            assert z["amount"] == 8 * 10**9
            comment = events[765]["raw"]["actions"][0]["TonTransfer"]["comment"]
            assert z["comment"] == (comment if n == 766 else "refund " + comment)
            q = D(8)
            if n == 766:
                paid = q
                cmds = [transfer("main", "refund_766", TON, q)]
            else:
                received = q
                cmds = [transfer("refund_766", "main", TON, q)]
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
        elif n in (725, 726, 728, 772, 773, 783):
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
                    or n in (724, 782)
                    or n <= 715
                    or n in (732, 749)
                ):
                    if n <= 715 or n in (732, 749):
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
                    assert n in (760, 780), ("Unmapped main receipt", n)
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
    plan["main_account_name"] = f"История main — события 1–{end}"
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
        block=f"0001-{end:04d}",
        total_events=end,
        total_movements=plan["summary"]["total_movements"] + len(ledger),
        compiled_contiguous_prefix=end,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan["limitations"] += [
        "Arbitrum integration is mandatory before posting the extended eighth block.",
        "3.595 TON on second remains a probable gift-service return, carrying pooled cost.",
    ]
    plan["summary"]["first_unimplemented_event"] = end + 1
    plan["summary"]["first_unimplemented_kind"] = (
        "Unresolved Ethereum cost boundary before the Bybit receipt"
    )
    plan["inputs"] += inputs + [
        dict(path=str(prefix), sha256=hashlib.sha256(prefix.read_bytes()).hexdigest())
    ]
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--end", type=int, default=800)
    a = p.parse_args()
    result = build(a.prefix, a.end)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n"
    )
    print(result["summary"])
