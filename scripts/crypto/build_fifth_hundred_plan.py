"""Compile events 401-500 from pinned quantities, carrying cash and funding units."""

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

BASE = "crypto-task/chronological-rebuild/blocks/0401-0500/accepted/v1/"
WORK = "crypto-task/crypto-reconciliation/work/"
MAIN = "0:29ee71155245d272af9946305e8f21959eff23a07582ebbda39d47fd8383decf"
COLD = "0:a52881caeb14f2139c17697363edd9979265c6a9ba7175b0dbe275a53fa9199e"
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

    start = events[399]["timestamp"]
    finish = events[499]["timestamp"]
    # Attach the established identities without changing or rewriting the first 400 sources.
    tags = []
    for row in original:
        for c in row["commands"]:
            if (
                c["kind"] == "create_protocol"
                and c["payload"].get("protocol_name") == "EVAA"
            ):
                tags.append(
                    C(
                        "tag_lending_account",
                        position_id=ref("protocol", row["source_id"].split("main:")[1]),
                        master_contract=MASTER_A,
                        user_contract=USER_A,
                    )
                )
    add(
        "evaa:account-identities:through400",
        start + 1,
        tags,
        dict(identity_audit="audit_evaa_accounts.py"),
    )
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
    # Side wallets: principal is booked by the main event; only their own fees and external routes here.
    bridge = read(BASE + "cold-jetton-bridge.json")
    bt = bridge["transactions"][0]
    txs = read(
        "crypto-task/chronological-rebuild/blocks/0201-0300/accepted/v1/evidence/intermediate-transactions.json"
    )["transactions"]
    tail = sorted(
        [t for t in txs if t["utime"] == bt["timestamp"]], key=lambda t: int(t["lt"])
    )[-1]
    delta = (
        D(plan["expected_accounts"]["intermediate"][TON])
        - D(tail["end_balance"]) / 10**9
    )
    add(
        "own:intermediate-cold:" + bt["event_id"],
        bt["timestamp"],
        [
            transfer("intermediate", "cold", JETTON, "1485.654757282"),
            fee("intermediate", TON, delta),
        ],
        dict(source=bt, transaction_end_balance=tail["end_balance"]),
        0,
    )
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
        pre = sum(
            D(e["extra"]) / 10**9 for e in cache["events"] if e["timestamp"] <= start
        )
        if pre > 0:
            add(
                "own:" + w + ":pre400-dust",
                start + 1,
                [reward(w, TON, pre)],
                dict(
                    prior_events=[e for e in cache["events"] if e["timestamp"] <= start]
                ),
                1,
            )
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
                if MAIN in (sender, recipient):
                    continue
                if sender == address:
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
        trace = read(f"outputs/crypto-fifth-block-dev/sources/trace-{n}.json", False)
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
        330: dict(
            coll=D("1995.599906465"), debt=D("2796.090211"), body=D("2773.057918")
        ),
        443: dict(coll=D(0), debt=D(0), body=D(0)),
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
    lots = {}
    # Hide friend financing, but retain its principal units to avoid contaminating own cost.
    fid = "friend:loan:433"
    add(
        fid,
        start + 2,
        [
            C(
                "create_protocol",
                investment_account_id=ref("account", "friend_bridge"),
                protocol_name="Друг — техническая сверка",
                position_type="lending",
                asset_symbol="TON",
                quantity="0",
                cost_basis_in_base="0",
                crypto_asset_id=ref("asset", "ton", TON),
                metadata=dict(source_event_id=fid),
            )
        ],
        dict(owner_decision=read(BASE + "owner-decisions.json")),
    )
    for n in range(401, 501):
        ev = events[n - 1]
        v = net[n]
        cmds = []
        paid = D(0)
        received = D(0)
        evidence = dict(accepted_review=reviews[n - 401])
        t = ev["timestamp"]
        order = int(ev["lt"])
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
        elif n in (401, 410):
            a = symbols["NOT"] if n == 401 else JETTON
            cmds = [transfer("main", "cold", a, -v[a])]
        elif n in (413, 414):
            cmds = [transfer("cold", "main", JETTON, v[JETTON])]
        elif n == 403:
            cmds = [C("close_protocol", position_id=proto(322), return_quantity="9000")]
        elif n in (408, 409):
            cmds = [create(n, JETTON, 2500, "staking", "swap.coffee")]
        elif n in (404, 416, 431):
            paid = D(".0725")
            cmds = [
                C(
                    "expense",
                    source_position_id=P("main"),
                    quantity=str(paid),
                    comment="Подтверждённый внешний расход",
                )
            ]
        elif n in (405, 417, 418, 419, 428, 429, 430, 432, 472, 473, 498):
            cmds = [reward("main", JETTON, v[JETTON])]
            if n == 472:
                paid = D(".0725")
                cmds.insert(
                    0,
                    C(
                        "expense",
                        source_position_id=P("main"),
                        quantity=str(paid),
                        comment="Подтверждённый внешний расход",
                    ),
                )
        elif n in (407, 415, 427):
            mint = next(
                a["JettonMint"]
                for a in ev["raw"]["actions"]
                if a["type"] == "JettonMint"
            )
            lp = mint["jetton"]["address"]
            lq = D(mint["amount"]) / 10 ** int(mint["jetton"]["decimals"])
            a = TON if n == 415 else USDT
            qa = D(270) if n == 415 else -v[USDT]
            qb = -v[JETTON]
            custody = mint["recipient"]["address"]
            lots[n] = dict(master=lp, q=lq, custody=custody)
            cmds = [
                create(
                    n,
                    a,
                    qa,
                    "liquidity_pool",
                    "STON.fi",
                    secondary_source_position_id=P("main", JETTON),
                    secondary_quantity=str(qb),
                    metadata=dict(
                        lp_receipt=dict(
                            master=lp,
                            quantity=str(lq),
                            custody=custody,
                            event_id=ev["event_id"],
                        )
                    ),
                )
            ]
            paid = qa if a == TON else D(0)
        elif n in (411, 422, 441):
            z = evaa(n)
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
        elif n in (421, 445):
            z = evaa(n)
            before = D(abs(z["before"]) * z["borrow"] // 10**12) / 10**6
            q = -v[USDT]
            cmds = accrue(n, 330, debt=before)
            x = loans[330]
            interest = (q * (before - x["body"]) / before).quantize(D(".000001"))
            cmds.append(
                C(
                    "repay",
                    position_id=proto(330),
                    source_position_id=P("main", USDT),
                    repay_qty=str(q),
                    interest_qty=str(interest),
                )
            )
            x["debt"] -= q
            x["body"] -= q - interest
            evidence["evaa"] = z
        elif n in (423, 442, 457, 493):
            paid = D({423: 300, 442: 423, 457: 65, 493: 140}[n])
            a = symbols["tsTON" if n == 423 else "TON-SLP"]
            cmds = [swap("main", TON, paid, a, v[a])]
        elif n in (424, 443):
            a = symbols["tsTON" if n == 424 else "TON-SLP"]
            q = -v[a]
            cmds = [create(n, a, q)]
            evidence["evaa"] = evaa(n)
            if n == 443:
                loans[443]["coll"] = q
        elif n in (458, 494):
            a = symbols["TON-SLP"]
            q = -v[a]
            cmds = [
                C(
                    "top_up_protocol",
                    position_id=proto(443),
                    source_position_id=P("main", a),
                    quantity=str(q),
                )
            ]
            loans[443]["coll"] += q
            evidence["evaa"] = evaa(n)
        elif n in (444, 459, 499):
            z = evaa(n)
            q = v[USDT]
            before = D(abs(z["before"]) * z["borrow"] // 10**12) / 10**6
            cmds = accrue(n, 443, debt=max(before, loans[443]["debt"])) + [
                C(
                    "borrow",
                    position_id=proto(443),
                    borrowed_crypto_asset_id=ref("asset", "ton", USDT),
                    debt_qty=str(q),
                    funding_policy="components",
                )
            ]
            loans[443]["debt"] += q
            loans[443]["body"] += q
            evidence["evaa"] = z
        elif n == 495:
            z = evaa(n)
            paid = D(140)
            after = D(z["after"] * z["supply"] // 10**12) / 10**9
            cmds = accrue(n, 330, coll=after - paid) + [
                C(
                    "top_up_protocol",
                    position_id=proto(330),
                    source_position_id=P("main"),
                    quantity=str(paid),
                )
            ]
            loans[330]["coll"] = after
            evidence["evaa"] = z
        elif n in (420, 426, 453, 455, 456, 474, 460, 500):
            spec = {
                420: (JETTON, "231.938640214", USDT, "41.981137"),
                426: (USDT, "273", JETTON, "1383.930931927"),
                453: (USDT, "59.828461", TON, "18.086219065"),
                455: (USDT, "197.486339", symbols["ECOR"], "5150.080465938"),
                456: (symbols["ECOR"], "5150.080465938", TON, "60.585884403"),
                474: (JETTON, "524", TON, "32.110804711"),
                460: (USDT, "110", symbols["stgUSD"], "107.903539"),
                500: (USDT, "20", symbols["PT eUSDT"], "20.473042228"),
            }
            a, q, b, r = spec[n]
            cmds = [swap("main", a, q, b, r)]
            received = D(r) if b == TON else D(0)
        elif n == 461:
            # PT carries the principal's cost and financing. The separately issued YT is
            # a right to future yield, with no additional own acquisition spending.
            cmds = [
                swap(
                    "main",
                    symbols["stgUSD"],
                    "47.788541",
                    symbols["PT stgUSD"],
                    v[symbols["PT stgUSD"]],
                ),
                reward("main", symbols["YT stgUSD"], v[symbols["YT stgUSD"]]),
            ]
            evidence["basis_policy"] = (
                "Principal cost and loan units retained by PT; YT carries no additional cash or principal units"
            )
        elif n == 462:
            a = symbols["stgUSD"]
            b = symbols["PT stgUSD"]
            lp = next(
                m["master"]
                for m in ledger
                if m["event_no"] == n and m["asset"] == "LP stgUSD"
            )
            lq = v[lp]
            lots[n] = dict(master=lp, q=lq, custody="main")
            cmds = [
                create(
                    n,
                    a,
                    "60.114997",
                    "liquidity_pool",
                    "Torch",
                    secondary_source_position_id=P("main", b),
                    secondary_quantity="48.647874",
                    metadata=dict(
                        lp_receipt=dict(
                            master=lp,
                            quantity=str(lq),
                            custody="main",
                            event_id=ev["event_id"],
                        )
                    ),
                )
            ]
        elif n == 433:
            received = D("40.36745508")
            add(
                "friend:borrow:433",
                t,
                [
                    C(
                        "borrow",
                        position_id=ref("protocol", fid),
                        borrowed_crypto_asset_id=ref("asset", "ton", TON),
                        debt_qty=str(received),
                        funding_policy="components",
                    )
                ],
                dict(owner_decision=True),
                order - 1,
            )
            cmds = [transfer("friend_bridge", "main", TON, received)]
        elif n == 440:
            paid = D("40.3")
            cmds = [
                C(
                    "repay",
                    position_id=ref("protocol", fid),
                    source_position_id=P("main"),
                    repay_qty=str(paid),
                    interest_qty="0",
                )
            ]
        elif n in (434, 436, 438, 447):
            paid = D({434: "20.2", 436: "25", 438: "28", 447: "2"}[n])
            cmds = [transfer("main", "pending_" + str(n), TON, paid)]
        elif n in (435, 437, 439, 448):
            received = (
                D(
                    next(
                        a["TonTransfer"]["amount"]
                        for a in ev["raw"]["actions"]
                        if a["type"] == "TonTransfer"
                    )
                )
                / 10**9
            )
            sent = D({435: "20.2", 437: "25", 439: "28", 448: "2"}[n])
            cmds = [transfer("pending_" + str(n - 1), "main", TON, min(received, sent))]
            if sent > received:
                cmds.append(fee("pending_" + str(n - 1), TON, sent - received))
            elif received > sent:
                cmds.append(reward("main", TON, received - sent))
        elif n in (412, 475, 482, 497, 487, 490):
            paid = D({412: 2, 475: 32, 482: 15, 497: 47, 487: 34, 490: 10}[n])
            dest = (
                "cold"
                if n in (412, 475)
                else "second"
                if n in (482, 497)
                else "shared_claim"
            )
            cmds = [transfer("main", dest, TON, paid)]
        elif n in (477, 481):
            received = D(20 if n == 477 else 10)
            cmds = [transfer("cold", "main", TON, received)]
        elif n in (449, 451, 463, 464, 465, 466, 471, 483, 485, 486):
            paid = (
                D(
                    next(
                        a["TonTransfer"]["amount"]
                        for a in ev["raw"]["actions"]
                        if a["type"] == "TonTransfer"
                    )
                )
                / 10**9
            )
            cmds = [
                C(
                    "expense",
                    source_position_id=P("main"),
                    quantity=str(paid),
                    comment="Внешний расход" if n in (451, 463) else "Telegram Stars",
                )
            ]
        elif n in (454, 468, 469, 470, 476, 478, 489):
            paid = (
                D(
                    next(
                        a["TonTransfer"]["amount"]
                        for a in ev["raw"]["actions"]
                        if a["type"] == "TonTransfer"
                    )
                )
                / 10**9
            )
            cmds = [transfer("main", "gifts", TON, paid)]
        elif n in (479, 480, 488):
            received = (
                D(
                    next(
                        a["TonTransfer"]["amount"]
                        for a in ev["raw"]["actions"]
                        if a["type"] == "TonTransfer"
                    )
                )
                / 10**9
            )
            cmds = [dict(gift_return=dict(wallet="main", quantity=str(received)))]
        elif n == 491:
            lot = lots[415]
            cmds = [
                C(
                    "lp_custody",
                    position_id=proto(415),
                    receipt_master=lot["master"],
                    quantity=str(lot["q"]),
                    from_custody=lot["custody"],
                    to_custody="main",
                ),
                reward("main", JETTON, v[JETTON]),
            ]
            lot["custody"] = "main"
        elif n == 492:
            received = D("283.634662695")
            cmds = [
                C(
                    "close_protocol",
                    position_id=proto(415),
                    return_quantity=str(received),
                    secondary_return_quantity=str(v[JETTON]),
                    allocation_policy="net_composition",
                )
            ]
            lots[415]["closed"] = True
        elif n == 450:
            pass
        else:
            raise ValueError(("Unimplemented main event", n))
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
    gifts = D(0)
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
    plan["expected_accounts"] = {
        **plan["expected_accounts"],
        "exchange_source": {TON: "0.55528", USDT: "0.01145505", eth: "0"},
        "intermediate": {TON: str(D(tail["end_balance"]) / 10**9), JETTON: "0"},
        "gifts": {TON: str(gifts)},
        **side_final,
    }
    plan["accepted_custody"] = [
        dict(master=lot["master"], quantity=str(lot["q"]), custody=lot["custody"])
        for lot in lots.values()
        if not lot.get("closed") and lot["custody"] != "main"
    ]
    plan["main_account_name"] = "История main — события 1–500"
    plan["account_display_names"] = {
        "cold": "Холодный кошелёк",
        "gifts": "Подарки и стикеры — вложенные TON",
        "ethereum_boundary": "Ethereum — до разбора сети",
        "shared_claim": "Общий счёт — переданные TON",
    }
    plan["internal_accounts"] = list(
        set(
            plan.get("internal_accounts", [])
            + ["friend_bridge"]
            + [f"pending_{n}" for n in (434, 436, 438, 447)]
        )
    )
    plan["expected_evaa"] = loans
    plan["expected_bank_USD"] = str(
        sum(
            D(c["payload"]["fiat_amount"])
            for row in plan["rows"]
            for c in row["commands"]
            if c["kind"] == "sell_fiat" and c["payload"]["fiat_currency_code"] == "USD"
        )
    )
    plan["summary"]["new_funding"] = {
        "RUB": str(sum(D(row.get("funding_RUB", "0")) for row in added))
    }
    plan["summary"].update(
        block="0001-0500",
        total_events=500,
        total_movements=1629,
        compiled_contiguous_prefix=500,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
    )
    plan["limitations"] += [
        "Historical EVAA rates decoded per operation; latest snapshots are not current-day balances.",
        "PT/YT split: principal cost and financing stay with PT; YT has no additional own cost.",
        "Friend loan hidden technical boundary; 0.06745508 TON remains owed, not income.",
        "Ethereum gross withdrawals retain cost at boundary pending separate chain reconciliation.",
        "Gift/sticker services pooled in TON with historical weighted cost, no item market valuation.",
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
