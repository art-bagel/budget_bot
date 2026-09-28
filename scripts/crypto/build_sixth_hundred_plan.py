"""Compile events 501-600 from pinned quantities, carrying cash and funding units."""

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
from audit_evaa_accounts import MASTER_A, MASTER_B, USER_A, USER_B
from verify_evaa_liquidations import command as decode, nodes, boc, Bits

BASE = "crypto-task/chronological-rebuild/blocks/0501-0600/accepted/v1/"
WORK = "crypto-task/crypto-reconciliation/work/"
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
        elif m["event_no"] == 600 and m["asset"] == "net":
            excluded[m["master"]] = dict(
                symbol="net",
                reason="Unverified unsolicited token, accepted exclusion event 600",
            )
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

    def create(n, a, q, typ="lending", name="EVAA", **kw):
        meta = kw.pop("metadata", {})
        meta["source_event_id"] = events[n - 1]["event_id"]
        if name == "EVAA":
            master, user = (MASTER_B, USER_B) if n == 443 else (MASTER_A, USER_A)
            meta.update(
                lending_account_key=master + "/" + user,
                lending_master_contract=master,
                lending_user_contract=user,
            )
        return C(
            "create_protocol",
            investment_account_id=ref("account", "main"),
            protocol_name=name,
            position_type=typ,
            asset_symbol=assets[a]["symbol"],
            quantity=str(q),
            source_position_id=P("main", a),
            crypto_asset_id=ref("asset", "ton", a),
            network_code="ton",
            metadata=meta,
            **kw,
        )

    start = events[499]["timestamp"]
    finish = events[599]["timestamp"]
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
        trace = read(f"outputs/crypto-sixth-block-dev/sources/trace-{n}.json", False)
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
            before = after - first - second if op == 17 else after + first - second
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
    refund_pairs = {
        505: 503,
        513: 508,
        523: 520,
        534: 525,
        547: 546,
        560: 554,
        530: 529,
        549: 544,
        577: 544,
    }
    sent = set(refund_pairs.values())
    for n in range(501, 601):
        ev = events[n - 1]
        v = net[n]
        cmds = []
        paid = received = D(0)
        evidence = dict(accepted_review=reviews[n - 501])
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
        elif n in (509, 511, 526, 532, 538):
            z = evaa(n)
            assert z["user"] == USER_A
            q = D(z["actual"]) / 10**9
            after = D(z["after"] * z["supply"] // 10**12) / 10**9
            cmds = accrue(n, 330, coll=after + q) + [
                C(
                    "partial_close_protocol",
                    position_id=proto(330),
                    principal_qty=str(q),
                )
            ]
            loans[330]["coll"] = after
            received = q
            evidence["evaa"] = z
        elif n == 574:
            trace = read("outputs/crypto-sixth-block-dev/sources/trace-409.json", False)
            stake = next(
                z["transaction"]
                for z in nodes(trace)
                if z["transaction"]["in_msg"].get("decoded_op_name")
                == "coffee_staking_init"
            )
            address = stake["account"]["address"]
            body = stake["in_msg"]["decoded_body"]
            assert (
                body["owner"] == MAIN
                and body["jetton_data"]["amount"] == "2500000000000"
            )
            assert body["position_data"]["period_id"] == 1
            assert (
                ev["raw"]["actions"][0]["SmartContractExec"]["contract"]["address"]
                == address
            )
            cmds = [C("close_protocol", position_id=proto(409), return_quantity="2500")]
            evidence["staking_link"] = dict(
                deposit_event=409,
                contract=address,
                period_id=1,
                verified_by="stake initialization and withdrawal contract",
            )
        elif n in (575, 597):
            paid = D("151.723393572" if n == 575 else "84.999999595")
            b = JETTON if n == 575 else USDT
            qb = -v[b]
            meta = {}
            if n == 575:
                mint = next(
                    a["JettonMint"]
                    for a in ev["raw"]["actions"]
                    if a["type"] == "JettonMint"
                )
                meta["lp_receipt"] = dict(
                    master=mint["jetton"]["address"],
                    quantity="601.044584860",
                    custody=mint["recipient"]["address"],
                    event_id=ev["event_id"],
                )
            else:
                meta["source_liquidity_deposit"] = ev["raw"]["actions"][0][
                    "LiquidityDeposit"
                ]
            cmds = [
                create(
                    n,
                    TON,
                    paid,
                    "liquidity_pool",
                    "STON.fi" if n == 575 else "TONCO",
                    secondary_source_position_id=P("main", b),
                    secondary_quantity=str(qb),
                    metadata=meta,
                )
            ]
        elif n in (584, 587, 588):
            cmds = [reward("main", JETTON, v[JETTON])]
        elif n in (585, 589, 593, 594):
            z = next(
                a["JettonSwap"]
                for a in ev["raw"]["actions"]
                if a["type"] == "JettonSwap"
            )
            q = D(z["amount_in"]) / 10**9
            if z.get("ton_out"):
                received = D(z["ton_out"]) / 10**9
                cmds = [swap("main", JETTON, q, TON, received)]
            else:
                cmds = [swap("main", JETTON, q, USDT, v[USDT])]
        elif n == 590:
            mint = next(
                a["JettonMint"]
                for a in events[574]["raw"]["actions"]
                if a["type"] == "JettonMint"
            )
            cmds = [
                C(
                    "lp_custody",
                    position_id=proto(575),
                    receipt_master=mint["jetton"]["address"],
                    quantity="601.044584860",
                    from_custody=mint["recipient"]["address"],
                    to_custody="main",
                ),
                reward("main", JETTON, v[JETTON]),
            ]
        elif n == 591:
            received = D("143.141758407")
            cmds = [
                C(
                    "close_protocol",
                    position_id=proto(575),
                    return_quantity=str(received),
                    secondary_return_quantity=str(v[JETTON]),
                    allocation_policy="net_composition",
                )
            ]
        elif n == 595:
            cmds = [create(n, JETTON, 2500, "staking", "swap.coffee")]
        elif n == 600:
            assert all(a == TON or a in excluded for a in v), v
        else:
            actions = ev["raw"]["actions"]
            assert len(actions) == 1 and actions[0]["type"] == "TonTransfer", n
            z = actions[0]["TonTransfer"]
            q = D(z["amount"]) / 10**9
            sender, recipient = z["sender"]["address"], z["recipient"]["address"]
            incoming = recipient == MAIN
            if incoming:
                received = q
            else:
                paid = q
            if n in sent:
                cmds = [transfer("main", f"pending_{n}", TON, q)]
            elif n in refund_pairs:
                cmds = [transfer(f"pending_{refund_pairs[n]}", "main", TON, q)]
            elif SECOND in (sender, recipient) or COLD in (sender, recipient):
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
            elif "Telegram Stars" in z.get("comment", "") or n == 583:
                cmds = [
                    C(
                        "expense",
                        source_position_id=P("main"),
                        quantity=str(q),
                        comment="Telegram Stars"
                        if n != 583
                        else "Сервисный платёж JETTON",
                    )
                ]
            elif incoming:
                cmds = [dict(gift_return=dict(wallet="main", quantity=str(q)))]
            else:
                cmds = [transfer("main", "gifts", TON, q)]
            if n == 577:
                cmds.append(
                    C(
                        "bank_sell",
                        position_id=P("pending_544"),
                        bank_account_id=ref("account", "primary_cash"),
                        quantity="23.05",
                        fiat_amount="5281.80",
                        comment="Продажа другу: остаток 23,05 TON; 5281,80 RUB — ранее принятая оценка, не банковский факт",
                    )
                )
                evidence["fiat_quality"] = "inherited_estimate_not_bank_fact"
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
    plan["inputs"] += inputs + [
        dict(path=str(prefix), sha256=hashlib.sha256(prefix.read_bytes()).hexdigest())
    ]
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
    plan["expected_accounts"]["exchange_source"] = {
        TON: "0",
        USDT: "0.01507505",
        eth: "0",
    }
    plan["expected_accounts"]["gifts"] = {TON: str(gifts)}
    plan["main_account_name"] = "История main — события 1–600"
    plan["internal_accounts"] = sorted(
        set(
            plan["internal_accounts"]
            + [f"pending_{n}" for n in sent]
            + ["sticker_refund_" + x["sent"][:16] for x in side_refunds]
        )
    )
    plan["expected_evaa"] = loans
    plan["expected_bank_RUB"] = str(D(plan["expected_bank_RUB"]) + D("5281.80"))
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
        block="0001-0600",
        total_events=600,
        total_movements=plan["summary"]["total_movements"] + len(ledger),
        compiled_contiguous_prefix=600,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan.setdefault("owner_decisions", []).append(
        dict(
            id="friend_sale_544_577_estimate",
            recorded_on="2026-09-24",
            response="полагаю что нет",
            meaning="Owner has no exact RUB proceeds; retain prior 5281.80 RUB estimate explicitly",
            events=[544, 549, 577],
        )
    )
    plan["limitations"] += [
        "Friend sale 23.05 TON: inherited 5281.80 RUB estimate, not bank confirmation.",
        "21 TON sticker refund matched by owner recollection, without shared refund identifier.",
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
