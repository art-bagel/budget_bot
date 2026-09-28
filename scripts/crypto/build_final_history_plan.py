"""Compile the remaining TON history and merge the prepared Arbitrum tail.

All posted prefix rows remain immutable. Quantities are checked against pinned
ledger movements; repayments use decoded historical EVAA rates, never live FX.
"""

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal as D, ROUND_DOWN
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from build_first_block_replay import PIN, TON, USDT
from build_history_inventory import git
from build_second_hundred_plan import JETTON, command as C, position as P
from compile_main_commands import ref
from build_eighth_hundred_plan import MAIN, COLD, SECOND, GROUP
from build_arbitrum_tail_check import build as build_tail
from build_arbitrum_plan import ETH, USDC
from verify_evaa_liquidations import command as decode, nodes, boc, Bits, dictionary
from audit_evaa_accounts import USER_A, USER_B

SOURCES = Path("outputs/crypto-final-block-dev/sources")
INVENTORY = Path("outputs/crypto-history-inventory-2026-09-23-v2")
BASE = "crypto-task/chronological-rebuild/blocks/"
NOM = "0:456db482ac09d7d9758e8d2ab6aa7031fc645dc76c19205aab964f43d3ed66c4"
LP = "0:46fe73fa794a69f3d6723d10b136dc884061df06e602ccb5d58414306efe5310"


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


def swap(w, a, q, b, v):
    return C(
        "swap",
        position_id=P(w, a),
        from_amount=str(q),
        to_crypto_asset_id=ref("asset", "ton", b),
        to_amount=str(v),
        basis_policy="carry",
    )


def buy(w, a, q, rub):
    return [
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
            investment_account_id=ref("account", w),
            crypto_asset_id=ref("asset", "ton", a),
            quantity=str(q),
        ),
    ]


def decode_evaa(n):
    trace = json.loads((SOURCES / f"trace-{n}.json").read_text())
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
            reply = next(t for t in ts if t["in_msg"].get("op_code") == "0x00000411")
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
        if op == 17 and after == 0 and first > 0 and second > 0:
            before = -first  # excess supply was returned rather than kept as collateral
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


def build(prefix):
    original = json.loads(prefix.read_text())
    plan = build_tail(
        prefix, INVENTORY / "bybit-rows.json", Path("outputs/ethereum-inventory")
    )
    plan.pop("diagnostic_only", None)
    plan.pop("diagnostic_reason", None)
    original_rows = deepcopy(original["rows"])
    inputs = []

    def read(b, f):
        path = BASE + b + "/accepted/v1/" + f
        raw = git("show", PIN + ":" + path)
        inputs.append(
            dict(path=path, commit=PIN, sha256=hashlib.sha256(raw).hexdigest())
        )
        return json.loads(raw)

    events = json.loads((INVENTORY / "main-events.json").read_text())
    blocks = ["0801-0900", "0901-1049"]
    ledger = sum([read(b, "ledger.json") for b in blocks], [])
    reviews = {r["event_no"]: r for b in blocks for r in read(b, "review.json")}
    links = {
        r["event_no"]: r for b in blocks for r in read(b, "evaa-evidence-links.json")
    }
    servers = {
        r["event_id"]: r for b in blocks for r in read(b, "server-purchases.json")
    }
    boundary = read(blocks[1], "bybit-wallet-links.json")
    boundary += [
        dict(line=648, event_no=875, asset="USDT", received="83.5", sent="83.5"),
        dict(
            line=684,
            event_id=events[898]["event_id"],
            wallet="main",
            asset="USDT",
            received="100",
            gross="100.15",
        ),
    ]
    bybit = json.loads((INVENTORY / "bybit-rows.json").read_text())
    byevent = {
        r.get(
            "event_id",
            events[r["event_no"] - 1]["event_id"] if "event_no" in r else None,
        ): r
        for r in boundary
    }
    assets = plan["assets"]
    excluded = plan["excluded_assets"]
    net = defaultdict(lambda: defaultdict(D))
    for m in ledger:
        net[m["event_no"]][m["master"]] += D(m["delta_atomic"]) / 10 ** m["decimals"]
        if m.get("excluded_from_financial_perimeter") or (
            m["event_no"] in (983, 985, 1002, 1039) and m["master"] != TON
        ):
            excluded[m["master"]] = dict(symbol=m["asset"], reason="accepted exclusion")
        elif "LP" not in m["asset"] or m["asset"] == "TON-SLP":
            assets.setdefault(
                m["master"], dict(symbol=m["asset"], decimals=m["decimals"])
            )
    keys = {"TON": TON, "USDT": USDT, "ETH": ETH, "USDC": USDC}
    start, finish = events[799]["timestamp"], events[-1]["timestamp"]

    def dt(t):
        return (
            datetime.fromtimestamp(t, timezone.utc)
            if isinstance(t, int)
            else datetime.fromisoformat(t)
        )

    def add(sid, t, cs, evidence, order=0, **kw):
        t = dt(t)
        plan["rows"].append(
            dict(
                source_id=sid,
                occurred_at=t.isoformat(),
                accounting_date=t.astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=order,
                commands=cs,
                evidence=evidence,
                **kw,
            )
        )

    def proto(n):
        return ref("protocol", events[n - 1]["event_id"])

    def create(n, a, q, typ, name, metadata=None, **extra):
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
            metadata=dict(
                source_event_id=events[n - 1]["event_id"], **(metadata or {})
            ),
            **extra,
        )

    # Extend the exchange after the independently tested February Arbitrum tail.
    cutoff = max(r["occurred_at"] for r in plan["rows"])
    cards = json.loads(
        Path(
            "outputs/crypto-card-valuations-2026-09-23/result-v1/valued-card-conversions.json"
        ).read_text()
    )
    groups = defaultdict(list)
    for r in bybit:
        t = dt(r["Дата"] + "T" + r["Время"] + ":00+00:00")
        if dt(cutoff) < t <= dt(finish):
            groups[t.isoformat()].append(r)
    balance = {k: D(v) for k, v in plan["expected_accounts"]["exchange_source"].items()}
    seen_boundary = set()
    for t, rs in sorted(groups.items()):
        trades = [r for r in rs if r["Тип"] == "TRADE"]
        if trades:
            sums = defaultdict(D)
            for r in trades:
                sums[r["Актив"]] += D(r["Изменение"].replace(",", "."))
            neg = [(keys[a], -q) for a, q in sums.items() if q < 0]
            pos = [(keys[a], q) for a, q in sums.items() if q > 0]
            assert len(neg) == len(pos) == 1, (t, sums)
            (a, q), (b, v) = neg[0], pos[0]
            add(
                "bybit:trades:" + t,
                t,
                [swap("exchange_source", a, q, b, v)],
                dict(source_rows=trades),
                max(r["_source_line"] for r in trades),
            )
        for r in rs:
            kind = r["Тип"]
            a = keys.get(r["Актив"])
            q = D(r["Изменение"].replace(",", "."))
            line = r["_source_line"]
            if not a:
                assert r["Актив"] == "USD" and kind == "Bybit Card", (line, r)
                continue
            cs = []
            extra = {}
            internal = (
                kind
                in ("TRANSFER_IN", "TRANSFER_OUT", "Transfer in", "Transfer out", "--")
                or kind == "Earn"
                and "Interest Distribution" not in r["Описание"]
            )
            if not internal:
                balance[a] = balance.get(a, D(0)) + q
            if kind == "Fiat":
                rub = r["₽"].replace(",", ".")
                cs = buy("exchange_source", a, q, rub)
                extra = dict(funding_RUB=rub, funding_quality="known")
            elif (
                kind == "Airdrop"
                or kind == "Earn"
                and "Interest Distribution" in r["Описание"]
            ):
                assert q > 0
                cs = [reward("exchange_source", a, q)]
            elif line == 688:
                assert q == 10 and a == USDT
                fid = "friend:bybit:10"
                cs = [
                    C(
                        "create_protocol",
                        investment_account_id=ref("account", "exchange_source"),
                        protocol_name="Друг — техническая сверка",
                        position_type="lending",
                        asset_symbol="USDT",
                        quantity="0",
                        cost_basis_in_base="0",
                        crypto_asset_id=ref("asset", "ton", USDT),
                        metadata=dict(source_event_id=fid),
                    )
                ]
                add(
                    fid,
                    t,
                    cs,
                    dict(
                        owner_confirmation="10 USDT received from friend and returned, confirmed by owner"
                    ),
                    line - 1,
                )
                cs = [
                    C(
                        "borrow",
                        position_id=ref("protocol", fid),
                        borrowed_crypto_asset_id=ref("asset", "ton", USDT),
                        debt_qty="10",
                        funding_policy="components",
                    )
                ]
            elif line in (652, 696):
                assert -q == D(600 if line == 652 else 10)
                cs = [
                    C(
                        "repay",
                        position_id=ref(
                            "protocol",
                            "friend:bybit:" + ("600" if line == 652 else "10"),
                        ),
                        source_position_id=P("exchange_source", USDT),
                        repay_qty=str(-q),
                        interest_qty="0",
                    )
                ]
            elif kind in ("Deposit", "Withdraw"):
                match = [x for x in boundary if x["line"] == line]
                assert len(match) == 1, (line, r)
                seen_boundary.add(line)
                # Chain event posts principal and exchange fee once, at actual arrival.
                assert (
                    D(match[0]["received"]) == q
                    if kind == "Deposit"
                    else D(match[0]["gross"]) == -q
                )
            elif kind == "Bybit Card" and q < 0:
                v = next(v for v in cards if line in v["source_lines"])
                if line != min(
                    x["_source_line"]
                    for x in rs
                    if x["Тип"] == "Bybit Card"
                    and x["Актив"] == r["Актив"]
                    and x["_source_line"] in v["source_lines"]
                ):
                    continue
                cs = [
                    C(
                        "sell_fiat",
                        investment_account_id=ref("account", "exchange_source"),
                        bank_account_id=ref("account", "primary_cash"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=v["crypto_debits"][r["Актив"]],
                        fiat_currency_code="USD",
                        fiat_amount=v["pending_manual_amount"],
                        historical_value_in_base=v["historical_value_in_base"],
                        valuation_source="Bybit export and prepared historical CBR rate",
                        defer_manual_expense=True,
                    )
                ]
            elif kind != "TRADE" and not internal:
                raise AssertionError(r)
            if cs:
                add("bybit:row:" + str(line), t, cs, dict(source=r), line, **extra)
    assert seen_boundary == {r["line"] for r in boundary}
    plan["expected_accounts"]["exchange_source"] = {
        k: str(v) for k, v in balance.items()
    }

    def boundary_commands(link, w):
        a = keys[link["asset"]]
        q = D(link["received"])
        if "gross" in link:
            gross = D(link["gross"])
            return [transfer("exchange_source", w, a, q)] + (
                [fee("exchange_source", a, gross - q)] if gross > q else []
            )
        sent = D(link["sent"])
        return [transfer(w, "exchange_source", a, q)] + (
            [fee(w, a, sent - q)] if sent > q else []
        )

    loans = {
        int(k): {a: D(v) for a, v in x.items()}
        for k, x in original["expected_evaa"].items()
    }
    loans[424] = dict(coll=D("282.411205717"))
    running = {
        k: D(v)
        for k, v in next(r for r in reversed(original_rows) if "expected_main" in r)[
            "expected_main"
        ].items()
    }
    lp_lots = {
        n: deepcopy(
            next(
                c["payload"]
                for r in original_rows
                if r.get("event_no") == n
                for c in r["commands"]
                if c["kind"] == "create_protocol"
            )
        )
        for n in (407, 427)
    }
    for n in range(801, 1050):
        ev = events[n - 1]
        v = net[n]
        cs = []
        paid = received = D(0)
        extra = {}
        evidence = dict(accepted_review=reviews[n])
        for a, q in v.items():
            running[a] = running.get(a, D(0)) + q
        actions = ev["raw"]["actions"]
        types = [a["type"] for a in actions]
        sid = ev["event_id"]
        if sid in byevent:
            link = byevent[sid]
            cs = boundary_commands(link, "main")
            evidence["exchange_link"] = link
            if link["asset"] == "TON":
                if "gross" in link:
                    received = D(link["received"])
                else:
                    paid = D(link["sent"])
        elif sid in servers:
            s = servers[sid]
            received = D(s["quantity_TON"])
            cs = buy("main", TON, received, s["fiat_paid_RUB"])
            extra = dict(funding_RUB=s["fiat_paid_RUB"], funding_quality="known")
            evidence["server_purchase"] = s
        elif n in links:
            z = decode_evaa(n)
            link = links[n]
            assert z["user"] == (USER_A if link["profile"] == "old" else USER_B)
            assert z["transaction"] == link["transaction"]
            assert (
                z["before"] == link["principal_before"]
                and z["after"] == link["principal_after"]
            ), (n, z, link)
            assert z["actual"] == link["amount_atomic"]
            evidence["evaa"] = z
            root = (
                (330 if link["profile"] == "old" else 443)
                if link["kind"] == "debt_repayment"
                else (
                    424
                    if link["asset"] == "tsTON"
                    else 443
                    if link["asset"] == "TON-SLP"
                    else 330
                    if link["profile"] == "old"
                    else 746
                )
            )
            x = loans[root]
            if link["kind"] == "debt_repayment":
                q = -v[USDT]
                after = D(abs(z["after"]) * z["borrow"] // 10**12) / 10**6
                before = after + q
                assert before >= x["debt"], (n, before, x)
                interest = (
                    (q * (before - x["body"]) / before).quantize(D(".000001"))
                    if after
                    else before - x["body"]
                )
                cs = [
                    C(
                        "accrue",
                        position_id=proto(root),
                        collateral_qty="0",
                        interest_qty=str(before - x["debt"]),
                        interest_value_in_base="0",
                        collateral_before=str(x["coll"]),
                        debt_before=str(x["debt"]),
                    ),
                    C(
                        "repay",
                        position_id=proto(root),
                        source_position_id=P("main", USDT),
                        repay_qty=str(q),
                        interest_qty=str(interest),
                    ),
                ]
                x.update(debt=after, body=x["body"] - q + interest)
                evidence["net_repayment"] = str(q)
            else:
                q = D(z["actual"]) / 10**9
                after = D(z["after"] * z["supply"] // 10**12) / 10**9
                supply = link["kind"] == "collateral_supply"
                before = after - q if supply else after + q
                assert before >= x["coll"], (n, before, x)
                cs = [
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
                if supply:
                    cs.append(
                        C(
                            "top_up_protocol",
                            position_id=proto(root),
                            source_position_id=P("main"),
                            quantity=str(q),
                        )
                    )
                else:
                    cs.append(
                        C(
                            "partial_close_protocol",
                            position_id=proto(root),
                            principal_qty=str(q),
                        )
                    )
                x["coll"] = after
                if link["asset"] == "TON":
                    if supply:
                        paid = q
                    else:
                        received = q
        elif n in (852, 853):
            root = 407 if n == 852 else 427
            p = lp_lots[root]
            receipt = p["metadata"]["lp_receipt"]
            q = v[LP]
            assert q == D(receipt["quantity"])
            cs = [
                C(
                    "lp_custody",
                    position_id=proto(root),
                    receipt_master=LP,
                    quantity=str(q),
                    from_custody=receipt["custody"],
                    to_custody="main",
                ),
                reward("main", JETTON, v[JETTON]),
            ]
        elif n == 854:
            total = sum(
                D(p["metadata"]["lp_receipt"]["quantity"]) for p in lp_lots.values()
            )
            remaining = {a: v[a] for a in (USDT, JETTON)}
            for i, (root, p) in enumerate(lp_lots.items()):
                ratio = D(p["metadata"]["lp_receipt"]["quantity"]) / total
                amounts = {
                    a: remaining[a]
                    if i == 1
                    else (v[a] * ratio).quantize(
                        D(10) ** -assets[a]["decimals"], rounding=ROUND_DOWN
                    )
                    for a in remaining
                }
                cs.append(
                    C(
                        "close_protocol",
                        position_id=proto(root),
                        return_quantity=str(amounts[USDT]),
                        secondary_return_quantity=str(amounts[JETTON]),
                        allocation_policy="net_composition",
                    )
                )
                for a, q in amounts.items():
                    remaining[a] -= q
        elif n in (855, 997, 1018):
            a, q = next(
                (a, -q)
                for a, q in v.items()
                if a != TON and q < 0 and a not in excluded
            )
            b = TON if n == 1018 else USDT
            out = D(actions[1]["TonTransfer"]["amount"]) / 10**9 if b == TON else v[b]
            cs = [swap("main", a, q, b, out)]
            received = out if b == TON else D(0)
        elif n in (856, 858):
            cs = [create(n, JETTON, -v[JETTON], "staking", "swap.coffee")]
        elif n in (857, 1027):
            root = 408 if n == 857 else 595
            trace = json.loads((SOURCES / f"trace-{root}.json").read_text())
            stake = next(
                z["transaction"]
                for z in nodes(trace)
                if z["transaction"]["in_msg"].get("decoded_op_name")
                == "coffee_staking_init"
            )
            assert (
                actions[0]["SmartContractExec"]["contract"]["address"]
                == stake["account"]["address"]
            )
            assert (
                stake["in_msg"]["decoded_body"]["jetton_data"]["amount"]
                == "2500000000000"
            )
            cs = [
                C(
                    "close_protocol",
                    position_id=proto(root),
                    return_quantity=str(v[JETTON]),
                )
            ]
            evidence["staking_deposit_event"] = root
        elif n == 863:
            cs = [
                C(
                    "expense",
                    source_position_id=P("main", JETTON),
                    quantity="12",
                    comment="Подарок другу — подтверждённое правило владельца",
                )
            ]
        elif n in (943, 1028):
            minted = next(a["JettonMint"] for a in actions if a["type"] == "JettonMint")
            assert minted["jetton"]["address"] == LP
            receipt = dict(
                master=LP,
                quantity=str(D(minted["amount"]) / 10**9),
                custody=minted["recipient"]["address"],
                event_id=sid,
            )
            a = USDT if n == 943 else JETTON
            kw = (
                dict(
                    secondary_source_position_id=P("main", JETTON),
                    secondary_quantity=str(-v[JETTON]),
                )
                if n == 943
                else {}
            )
            cs = [
                create(
                    n,
                    a,
                    -v[a],
                    "liquidity_pool",
                    "STON.fi",
                    dict(
                        lp_receipt=receipt,
                        entry_policy="actual contributed tokens; one-sided entry"
                        if n == 1028
                        else "two-sided entry",
                    ),
                    **kw,
                )
            ]
        elif n == 1046:
            paid = D("53.0835")
            cs = [transfer("main", "pending_coffee_1046", TON, paid)]
        elif n == 1047:
            received = v[TON]
            cs = [
                transfer("pending_coffee_1046", "main", TON, received),
                swap(
                    "pending_coffee_1046", TON, D("53.0835") - received, USDT, v[USDT]
                ),
            ]
            cs[-1]["payload"]["target_investment_account_id"] = ref("account", "main")
        elif "JettonSwap" in types:
            z = next(a["JettonSwap"] for a in actions if a["type"] == "JettonSwap")
            a = TON if z.get("ton_in") else z["jetton_master_in"]["address"]
            b = TON if z.get("ton_out") else z["jetton_master_out"]["address"]
            q = (
                D(z["ton_in"]) / 10**9
                if a == TON
                else D(z["amount_in"]) / 10 ** int(z["jetton_master_in"]["decimals"])
            )
            out = (
                D(z["ton_out"]) / 10**9
                if b == TON
                else D(z["amount_out"]) / 10 ** int(z["jetton_master_out"]["decimals"])
            )
            cs = [swap("main", a, q, b, out)]
            paid = q if a == TON else D(0)
            received = out if b == TON else D(0)
        elif n in (834, 835, 836):
            paid = D(actions[0]["SmartContractExec"]["ton_attached"]) / 10**9
            back = sum(
                D(a["TonTransfer"]["amount"]) / 10**9
                for a in actions
                if a["type"] == "TonTransfer"
                and a["TonTransfer"]["recipient"]["address"] == MAIN
            )
            paid -= back
            cs = [transfer("main", "gifts", TON, paid)]
            evidence["purpose_quality"] = (
                "probable gifts, owner does not recall; net funding retained"
            )
        elif n in (837, 859, 973, 1001, 1039):
            pass
        elif any(
            a["type"] == "JettonTransfer"
            and a.get("JettonTransfer", {}).get("jetton", {}).get("address") == USDT
            and COLD
            in (
                a["JettonTransfer"].get("sender", {}).get("address"),
                a["JettonTransfer"].get("recipient", {}).get("address"),
            )
            for a in actions
        ):
            q = v[USDT]
            cs = [
                transfer(
                    "cold" if q > 0 else "main",
                    "main" if q > 0 else "cold",
                    USDT,
                    abs(q),
                )
            ]
        elif any(a != TON and q > 0 and a not in excluded for a, q in v.items()):
            assert all(
                q >= 0 for a, q in v.items() if a != TON and a not in excluded
            ), (n, v)
            cs = [
                reward("main", a, q)
                for a, q in v.items()
                if a != TON and q > 0 and a not in excluded
            ]
            evidence["reward_policy"] = "zero new own-money cost"
        elif types and types[0] == "TonTransfer":
            z = actions[0]["TonTransfer"]
            q = D(z["amount"]) / 10**9
            sender = z["sender"]["address"]
            recipient = z["recipient"]["address"]
            incoming = recipient == MAIN
            if sender != recipient:
                if incoming:
                    received = q
                else:
                    paid = q
                own = {COLD: "cold", SECOND: "second", GROUP: "shared_claim"}
                other = sender if incoming else recipient
                if other in own:
                    cs = [
                        transfer(
                            own[other] if incoming else "main",
                            "main" if incoming else own[other],
                            TON,
                            q,
                        )
                    ]
                elif incoming and (q <= D(".001") or n in (873, 874)):
                    cs = [reward("main", TON, q)]
                    evidence["micro_policy"] = (
                        "zero new own cost; unsolicited offer is not a proven sale"
                    )
                elif (
                    "Telegram Stars" in z.get("comment", "")
                    or "сервисный сбор" in reviews[n]["interpretation"]
                ):
                    assert not incoming
                    cs = [
                        C(
                            "expense",
                            source_position_id=P("main"),
                            quantity=str(q),
                            comment="Telegram Stars"
                            if "Telegram Stars" in z.get("comment", "")
                            else "Сервисный сбор",
                        )
                    ]
                elif incoming:
                    cs = [transfer("gifts", "main", TON, q)]
                else:
                    cs = [transfer("main", "gifts", TON, q)]
                    evidence["purpose_quality"] = (
                        "gift/market perimeter per owner; exact item unconfirmed"
                    )
        else:
            assert all(a == TON or a in excluded or q == 0 for a, q in v.items()), (
                n,
                types,
                v,
            )
        technical = received - paid - v.get(TON, D(0))
        if technical > 0:
            cs.append(fee("main", TON, technical))
        elif technical < 0:
            cs.append(
                C(
                    "fee_refund",
                    investment_account_id=ref("account", "main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(-technical),
                )
            )
        if not cs:
            ignored = [
                dict(master=a, quantity=str(q))
                for a, q in v.items()
                if a in excluded and q
            ]
            assert all(q == 0 or a in excluded for a, q in v.items()), (n, v)
            if ignored:
                evidence["excluded_token_movements"] = ignored
            else:
                evidence["zero_movement"] = True
            cs = [
                C(
                    "observation",
                    comment="Техническое событие или посторонний токен вне учётного периметра",
                )
            ]
        add(
            "main:" + sid,
            ev["timestamp"],
            cs,
            evidence,
            int(ev["lt"]),
            event_no=n,
            expected_main={k: str(q) for k, q in running.items()},
            **extra,
        )
    # Own-wallet gas and non-main movements, independently checked against raw feeds.
    nomroot = next(
        c["payload"]["metadata"]["source_event_id"]
        for r in original_rows
        for c in r["commands"]
        if c["kind"] == "create_protocol"
        and c["payload"]["protocol_name"] == "TON Nominator"
    )
    for w, address in [("cold", COLD), ("second", SECOND)]:
        path = Path("outputs/crypto-fifth-block-dev/sources") / (w + ".json")
        raw = path.read_bytes()
        inputs.append(dict(path=str(path), sha256=hashlib.sha256(raw).hexdigest()))
        cache = json.loads(raw)["events"]
        quantities = defaultdict(D)
        for e in cache:
            if e["timestamp"] > finish:
                continue
            quantities[TON] += D(e["extra"]) / 10**9
            for action in e["actions"]:
                if action["status"] != "ok":
                    continue
                z = action.get(action["type"], {})
                if action["type"] == "TonTransfer":
                    a, q = TON, D(z["amount"]) / 10**9
                elif action["type"] == "JettonTransfer":
                    a, q = (
                        z["jetton"]["address"],
                        D(z["amount"]) / 10 ** int(z["jetton"]["decimals"]),
                    )
                elif action["type"] == "JettonMint":
                    # Unsolicited tokens are outside the accepted financial perimeter.
                    assert z["jetton"]["address"] not in assets
                    continue
                else:
                    continue
                if z.get("sender", {}).get("address") == address:
                    quantities[a] -= q
                if z.get("recipient", {}).get("address") == address:
                    quantities[a] += q
            if not start < e["timestamp"] <= finish:
                continue
            cs = []
            extra = {}
            evidence = dict(source=e)
            special = e["event_id"] in byevent or e["event_id"] in servers
            if e["event_id"] in byevent:
                link = byevent[e["event_id"]]
                assert link["wallet"] == w
                cs = boundary_commands(link, w)
                evidence["exchange_link"] = link
            elif e["event_id"] in servers:
                s = servers[e["event_id"]]
                assert s["wallet"] == w
                cs = buy(w, TON, s["quantity_TON"], s["fiat_paid_RUB"])
                extra = dict(funding_RUB=s["fiat_paid_RUB"], funding_quality="known")
                evidence["server_purchase"] = s
            for action in e["actions"]:
                if action["status"] != "ok" or action["type"] not in (
                    "TonTransfer",
                    "JettonTransfer",
                ):
                    continue
                z = action[action["type"]]
                sender = z.get("sender", {}).get("address")
                recipient = z.get("recipient", {}).get("address")
                if MAIN in (sender, recipient) or sender == recipient:
                    continue
                if action["type"] == "TonTransfer":
                    a, q = TON, D(z["amount"]) / 10**9
                else:
                    a, q = (
                        z["jetton"]["address"],
                        D(z["amount"]) / 10 ** int(z["jetton"]["decimals"]),
                    )
                if not q or special:
                    continue
                if a not in assets:
                    continue
                incoming = recipient == address
                other = sender if incoming else recipient
                if other == NOM:
                    assert a == TON and w == "cold"
                    if incoming:
                        continue
                    accepted = q - D(".2")
                    back = sum(
                        D(x["TonTransfer"]["amount"]) / 10**9
                        for x in e["actions"]
                        if x["type"] == "TonTransfer"
                        and x["TonTransfer"]["sender"]["address"] == NOM
                    )
                    assert any(
                        x.get("TonTransfer", {})
                        .get("comment", "")
                        .startswith("Stake " + str(accepted).rstrip("0").rstrip("."))
                        for x in e["actions"]
                    )
                    cs += [
                        C(
                            "top_up_protocol",
                            position_id=ref("protocol", nomroot),
                            source_position_id=P(w),
                            quantity=str(accepted),
                        ),
                        fee(w, TON, D(".2") - back),
                    ]
                elif other == GROUP:
                    cs.append(
                        transfer(
                            "shared_claim" if incoming else w,
                            w if incoming else "shared_claim",
                            a,
                            q,
                        )
                    )
                elif other in (COLD, SECOND):
                    if not incoming:
                        cs.append(
                            transfer(w, "cold" if other == COLD else "second", a, q)
                        )
                elif incoming and a == TON and q <= D(".001"):
                    cs.append(reward(w, a, q))
                elif a == TON:
                    cs.append(
                        transfer(
                            "gifts" if incoming else w, w if incoming else "gifts", a, q
                        )
                    )
                else:
                    raise AssertionError((w, e["event_id"], action["type"], a, q))
            gas = D(e["extra"]) / 10**9
            if gas < 0:
                cs.append(fee(w, TON, -gas))
            elif gas > 0:
                cs.append(reward(w, TON, gas))
            if cs:
                add(
                    "own:" + w + ":" + e["event_id"],
                    e["timestamp"],
                    cs,
                    evidence,
                    int(e["lt"]) + 1,
                    **extra,
                )
        plan["expected_accounts"][w] = {
            a: str(q) for a, q in quantities.items() if a in assets
        }
    plan["rows"].sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    assert plan["rows"][: len(original_rows)] == original_rows
    assert len({r["source_id"] for r in plan["rows"]}) == len(plan["rows"])
    # Transfer-only boundaries are reconstructed from immutable opening quantities.
    for w in ["gifts", "shared_claim"]:
        q = D(original["expected_accounts"][w][TON])
        for row in plan["rows"][len(original_rows) :]:
            for c in row["commands"]:
                if c["kind"] != "transfer":
                    continue
                p = c["payload"]
                if p["position_id"] == P(w):
                    q -= D(p["amount"])
                if p["target_investment_account_id"] == ref("account", w):
                    q += D(p["amount"])
                assert q >= 0, (w, row["source_id"], q)
        plan["expected_accounts"][w] = {TON: str(q)}
    plan["expected_accounts"]["pending_coffee_1046"] = {TON: "0", USDT: "0"}
    plan["internal_accounts"] += ["pending_coffee_1046"]
    plan["expected_evaa"] = loans
    plan["accepted_custody"] = [
        c["payload"]["metadata"]["lp_receipt"]
        for r in plan["rows"]
        if r.get("event_no") in (943, 1028)
        for c in r["commands"]
        if c["kind"] == "create_protocol"
    ]
    plan["expected_bank_USD"] = str(
        sum(
            D(c["payload"]["fiat_amount"])
            for r in plan["rows"]
            for c in r["commands"]
            if c["kind"] == "sell_fiat" and c["payload"]["fiat_currency_code"] == "USD"
        )
    )
    plan["events"] += [
        dict(
            event_no=n,
            event_id=events[n - 1]["event_id"],
            description=reviews[n]["interpretation"],
            status="command_mapped",
            uploaded=False,
        )
        for n in range(801, 1050)
    ]
    plan["summary"].update(
        block="0001-1049",
        total_events=1049,
        total_movements=original["summary"]["total_movements"] + len(ledger),
        compiled_contiguous_prefix=1049,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
        first_unimplemented_event=None,
        first_unimplemented_kind=None,
    )
    plan["summary"]["new_funding"] = {
        "RUB": str(
            D(plan["summary"]["documented_funding_RUB"])
            - D(original["summary"]["documented_funding_RUB"])
        )
    }
    plan["main_account_name"] = "История main — события 1–1049"
    plan["close_block"] = True
    for path in sorted(SOURCES.glob("trace-*.json")):
        inputs.append(
            dict(path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        )
    plan["inputs"] += inputs
    plan["limitations"] = [
        x
        for x in plan["limitations"]
        if not x.startswith("Arbitrum integration is mandatory")
    ]
    plan["limitations"] += [
        "Aave collateral and debt show last verified action balances; historical passive index snapshot remains separate.",
        "Unreturned market funding follows the owner gift-asset convention; specific NFT purchases are not reconstructed.",
        "EVAA liquidation penalty is not independently separated from collateral seized.",
        "One-sided LP entry 1028 retains actual JETTON input basis; current pool composition is not a market valuation.",
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
