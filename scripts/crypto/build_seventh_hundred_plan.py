"""Compile events 601-700 from pinned quantities, carrying cash and funding units."""

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
from audit_evaa_accounts import USER_A, USER_B
from verify_evaa_liquidations import command as decode, nodes, boc, Bits

BASE = "crypto-task/chronological-rebuild/blocks/0601-0700/accepted/v1/"
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
    cp = read(BASE + "checkpoint.json")
    bybit = read(
        "outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json", False
    )
    byend = read(BASE + "bybit-cost-continuation.json")
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

    start = events[599]["timestamp"]
    finish = events[699]["timestamp"]
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

    # Decode historical EVAA request rates + the successful response principal.
    def evaa(n):
        trace = read(f"outputs/crypto-seventh-block-dev/sources/trace-{n}.json", False)
        assert trace.get("emulated") is False
        ts = [z["transaction"] for z in nodes(trace)]
        for tx in ts:
            if tx["account"]["address"] not in (USER_A, USER_B):
                continue
            try:
                cells, b, version, upgrade, op, query = decode(tx["in_msg"]["raw_body"])
            except (AssertionError, KeyError):
                continue
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

    def accrue(n, loan, coll=None, debt=None):
        x = loans[loan]
        coll = x["coll"] if coll is None else coll
        debt = x["debt"] if debt is None else debt
        assert coll >= x["coll"] and debt >= x["debt"], (n, x, coll, debt)
        out = []
        if coll != x["coll"] or debt != x["debt"]:
            out = [
                C(
                    "accrue",
                    position_id=proto(loan),
                    collateral_qty=str(coll - x["coll"]),
                    interest_qty=str(debt - x["debt"]),
                    interest_value_in_base="0",
                    collateral_before=str(x["coll"]),
                    debt_before=str(x["debt"]),
                )
            ]
        x.update(coll=coll, debt=debt)
        return out

    running = {
        k: D(v)
        for k, v in next(r for r in reversed(original) if "expected_main" in r)[
            "expected_main"
        ].items()
    }
    receipts = {int(k): v for k, v in byend["receipts"].items()}
    for n in range(601, 701):
        ev = events[n - 1]
        v = net[n]
        cmds = []
        paid = received = D(0)
        evidence = dict(accepted_review=reviews[n - 601])
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
        elif n in (649, 663):
            z = evaa(n)
            assert z["user"] == USER_A
            link = next(
                x for x in read(BASE + "evaa-cost-links.json") if x["event_no"] == n
            )
            assert z["before"] == link["principal_before"]
            assert z["after"] == link["principal_after"]
            assert z["actual"] == link["amount_atomic"]
            q = D(z["actual"]) / 10**9
            after = D(z["after"] * z["supply"] // 10**12) / 10**9
            if n == 649:
                assert q == 90
                cmds = accrue(n, 330, coll=after + q) + [
                    C(
                        "partial_close_protocol",
                        position_id=proto(330),
                        principal_qty=str(q),
                    )
                ]
                received = q
            else:
                assert q == 123
                cmds = accrue(n, 330, coll=after - q) + [
                    C(
                        "top_up_protocol",
                        position_id=proto(330),
                        source_position_id=P("main"),
                        quantity=str(q),
                    )
                ]
                paid = q
            loans[330]["coll"] = after
            evidence["evaa"] = z
        elif n == 662:
            proof = read(BASE + "tonco-proof.json")
            assert proof["status"] == "PASS" and proof["mint_event"] == 597
            assert proof["capital_raw"][1] == 0
            assert proof["burned_liquidity"] == proof["position"]["liquidity"]
            for filename, sha in proof["sources"].items():
                read(BASE + filename)
                assert inputs[-1]["sha256"] == sha
            principal = D(proof["capital_raw"][0]) / 10**9
            ton_reward = D(proof["fees_raw"][0]) / 10**9
            usdt_reward = D(proof["fees_raw"][1]) / 10**6
            assert usdt_reward == v[USDT]
            received = principal + ton_reward
            cmds = [
                C(
                    "close_protocol",
                    position_id=proto(597),
                    return_quantity=str(principal),
                    secondary_return_quantity="0",
                    allocation_policy="net_composition",
                ),
                reward("main", TON, ton_reward),
                reward("main", USDT, usdt_reward),
            ]
            evidence["tonco_proof"] = proof
        elif n in (601, 606, 610, 636, 637, 664):
            a = symbols["tgUSD"] if n == 601 else JETTON
            cmds = [reward("main", a, v[a])]
        elif ev["raw"]["actions"][0]["type"] == "JettonSwap":
            z = ev["raw"]["actions"][0]["JettonSwap"]
            a = z["jetton_master_in"]["address"]
            q = D(z["amount_in"]) / 10 ** int(z["jetton_master_in"]["decimals"])
            received = D(z["ton_out"]) / 10**9
            cmds = [swap("main", a, q, TON, received)]
        elif n in (670, 671, 672):
            assert ev["raw"]["actions"][0]["type"] == "NftItemTransfer"
            evidence["nft_policy"] = (
                "NFT outside crypto valuation; actual TON fees retained"
            )
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
                elif "Telegram Stars" in z.get("comment", "") or n == 609 or n >= 666:
                    if n >= 666:
                        assert q == D("0.03")
                    cmds = [
                        C(
                            "expense",
                            source_position_id=P("main"),
                            quantity=str(q),
                            comment="Telegram Stars"
                            if n in (630, 631, 651, 659)
                            else "Малый сервисный платёж",
                        )
                    ]
                elif incoming:
                    assert n in (634, 658), n
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
    for r in cp["main_wallet_balances"]:
        if r["master"] not in excluded:
            assert running.get(r["master"], 0) == D(r["quantity"]), r
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
    reference = read(BASE + "cost-bounds-0700.json")
    plan["expected_accounts"]["shared_claim"] = {
        TON: reference["final_accounts"]["own:group:principal_claim"][
            "quantity_or_units"
        ]
    }
    plan["expected_accounts"]["exchange_source"] = {
        TON: "0",
        USDT: "0.00660505",
        eth: "0",
    }
    plan["expected_accounts"]["gifts"] = {TON: str(gifts)}
    plan["main_account_name"] = "История main — события 1–700"
    plan["expected_evaa"] = loans
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
        block="0001-0700",
        total_events=700,
        total_movements=plan["summary"]["total_movements"] + len(ledger),
        compiled_contiguous_prefix=700,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan["limitations"] += [
        "52 and 61 JETTON are probable rewards per owner recollection, zero new own-money cost.",
        "5 TON via @push and 2.79 TON treated as probable service returns with gift pool carrying cost.",
        "Micro external TON receipts <=0.001 carry zero new own-money cost under accepted materiality policy.",
    ]
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
