"""Compile fourth hundred from frozen evidence; never reuse old cost vectors."""

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from build_first_block_replay import PIN, TON, USDT
from build_history_inventory import ROOT, git
from build_second_hundred_plan import JETTON, command as C, position as P
from compile_main_commands import ref
from verify_evaa_liquidations import command as decode_command, nodes

BASE = "crypto-task/chronological-rebuild/blocks/0301-0400/accepted/v2/"
HGRAM = "0:cf76af318c0872b58a9f1925fc29c156211782b9fb01f56760d292e56123bf87"


def build(prefix, dogs_spent=None):
    plan = json.loads(prefix.read_text())
    original = deepcopy(plan["rows"])
    inputs = []

    def read(path, pinned=False):
        raw = git("show", PIN + ":" + path) if pinned else (ROOT / path).read_bytes()
        inputs.append(
            dict(
                path=path,
                commit=PIN if pinned else None,
                sha256=hashlib.sha256(raw).hexdigest(),
            )
        )
        return json.loads(raw)

    reviews = read(BASE + "review.json", True)
    econ = {r["event_no"]: r for r in read(BASE + "economic-review.json", True)}
    ledger = read(BASE + "ledger.json", True)
    checkpoint = read(BASE + "checkpoint.json", True)
    tonco = read(
        "crypto-task/crypto-reconciliation/work/tonco-position-ledger/result.json", True
    )
    owner = read(BASE + "owner-decisions.json", True)
    events = read("outputs/crypto-history-inventory-2026-09-23-v2/main-events.json")
    telegram = {
        r["source_row"]: r
        for r in read(
            "outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json"
        )
    }
    purchases = read(
        "outputs/crypto-telegram-history-2026-09-23-v2/telegram-purchases.json"
    )
    bybit = read("outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json")
    assets = plan["assets"]
    net = defaultdict(lambda: defaultdict(D))
    exclusions = deepcopy(plan["excluded_assets"])
    for m in ledger:
        if m["delta_atomic"] is not None:
            net[m["event_no"]][m["master"]] += (
                D(m["delta_atomic"]) / 10 ** m["decimals"]
            )
        if (
            m["excluded_from_financial_perimeter"]
            or m["event_no"] in (380, 381, 382)
            and m["master"] != TON
        ):
            exclusions[m["master"]] = dict(
                symbol=m["asset"], reason="accepted unsolicited/scam exclusion"
            )
        elif "LP" not in m["asset"]:
            assets.setdefault(
                m["master"], dict(symbol=m["asset"], decimals=m["decimals"])
            )
    appended = []

    def add(sid, when, cmds, evidence, order=0, **extra):
        if isinstance(when, str):
            when = datetime.fromisoformat(when)
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

    def transfer(wallet, target, a, q):
        return C(
            "transfer",
            position_id=P(wallet, a),
            target_investment_account_id=ref("account", target),
            amount=str(q),
        )

    def fee(wallet, a, q):
        return C("fee", source_position_id=P(wallet, a), quantity=str(q))

    def reward(wallet, a, q):
        return C(
            "reward",
            investment_account_id=ref("account", wallet),
            crypto_asset_id=ref("asset", "ton", a),
            quantity=str(q),
        )

    def swap(wallet, a, qa, b, qb):
        return C(
            "swap",
            position_id=P(wallet, a),
            from_amount=str(qa),
            to_crypto_asset_id=ref("asset", "ton", b),
            to_amount=str(qb),
            basis_policy="carry",
        )

    def purchase(sid, when, wallet, a, q, rub, evidence, quality="known", order=0):
        add(
            sid,
            when,
            [
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
                    investment_account_id=ref("account", wallet),
                    crypto_asset_id=ref("asset", "ton", a),
                    quantity=str(q),
                    **(
                        dict(purchase_quality="estimated", purchase_source=sid)
                        if quality == "estimated"
                        else {}
                    ),
                ),
            ],
            evidence,
            order,
            funding_RUB=str(rub),
            funding_quality=quality,
        )

    def tgtime(r):
        return datetime.fromisoformat(
            r["date"] + "T" + (r["time_as_in_source"] or "00:00")
        ).replace(tzinfo=ZoneInfo("Europe/Moscow"))

    dogs = "service:telegram:DOGS"
    for r in purchases:
        if 110 <= r["source_row"] <= 129:
            a = USDT if r["asset"] == "USDT" else dogs
            purchase(
                r["source_key"],
                tgtime(r),
                "telegram",
                a,
                r["quantity"],
                r["fiat_amount"],
                dict(purchase=r),
                r["basis_quality"],
                r["source_row"],
            )
    # The documented rounded opening USDT is short by 0.055245 at the owner-confirmed exchange.
    # Preserve the source purchase and explicitly record a zero-cash quantity correction.
    r = telegram[111]
    add(
        r["source_key"],
        tgtime(r),
        [
            C(
                "quantity_correction",
                investment_account_id=ref("account", "telegram"),
                crypto_asset_id=ref("asset", "ton", USDT),
                quantity="0.055245",
                comment="Округление накопленного Telegram USDT: 0,854082 + 27,52 против подтверждённых 28,429327; без добавления затрат",
            ),
            swap("telegram", USDT, "28.429327", TON, "5.14"),
        ],
        dict(
            source=r,
            owner_spent_USDT="28.429327",
            quantity_correction={
                "amount": "0.055245",
                "reason": "document rounding and owner-confirmed spend",
            },
            rounding_assumption=True,
        ),
        111,
    )
    r = telegram[112]
    add(
        r["source_key"],
        tgtime(r),
        [
            transfer("telegram", "exchange_source", TON, "5"),
            fee("telegram", TON, "0.05"),
        ],
        dict(source=r, bybit_deposit_link=28),
        112,
    )
    r = telegram[119]
    if dogs_spent is not None:
        assert D(dogs_spent) > 0 and D(dogs_spent) <= D("103993.0468")
        major = "service:telegram:MAJOR"
        assets[major] = dict(symbol="MAJOR", decimals=9, network_code="telegram")
        add(
            r["source_key"],
            tgtime(r),
            [swap("telegram", dogs, dogs_spent, major, "25.018")],
            dict(source=r, owner_spent_DOGS=dogs_spent),
            119,
        )
    else:
        raise ValueError(
            "Telegram row119 requires owner DOGS quantity before final compilation"
        )

    # Bybit exports use UTC. Custody movements and Earn placement pairs remain
    # evidence only; trades and free yield affect the hidden calculation account.
    start = datetime.fromtimestamp(events[299]["timestamp"], timezone.utc)
    finish = datetime.fromtimestamp(events[399]["timestamp"], timezone.utc)
    groups = defaultdict(list)
    for r in bybit:
        when = datetime.fromisoformat(r["Дата"] + "T" + r["Время"]).replace(
            tzinfo=timezone.utc
        )
        if start < when <= finish:
            groups[when].append(r)
    bybit_card = []
    for when, rows in sorted(groups.items()):
        trades = [r for r in rows if r["Тип"] == "TRADE"]
        if trades:
            amounts = defaultdict(D)
            for r in trades:
                amounts[r["Актив"]] += D(r["Изменение"].replace(",", "."))
            neg = [(a, -q) for a, q in amounts.items() if q < 0]
            pos = [(a, q) for a, q in amounts.items() if q > 0]
            assert len(neg) == len(pos) == 1, (when, amounts)
            a, qa = neg[0]
            b, qb = pos[0]

            def key(a):
                return TON if a == "TON" else USDT

            add(
                "bybit:trades:" + when.isoformat(),
                when,
                [swap("exchange_source", key(a), qa, key(b), qb)],
                dict(source_rows=trades),
                max(r["_source_line"] for r in trades),
            )
        for r in rows:
            a = TON if r["Актив"] == "TON" else USDT if r["Актив"] == "USDT" else None
            if a is None:
                continue
            q = D(r["Изменение"].replace(",", "."))
            kind = r["Тип"]
            line = r["_source_line"]
            sid = "bybit:row:" + str(line)
            if kind == "Fiat":
                purchase(
                    sid,
                    when,
                    "exchange_source",
                    a,
                    q,
                    D(r["₽"].replace(",", ".")),
                    dict(source=r),
                    order=line,
                )
            elif q > 0 and (
                kind == "Airdrop"
                or kind == "Earn"
                and "Interest Distribution" in r["Описание"]
            ):
                add(sid, when, [reward("exchange_source", a, q)], dict(source=r), line)
            elif kind == "Bybit Card" and q < 0:
                bybit_card.append(r)
    # Card conversions need confirmed USD values and stay pending manual expenses.
    valued = read(
        "outputs/crypto-card-valuations-2026-09-23/result-v1/valued-card-conversions.json"
    )
    for r in bybit_card:
        match = next(v for v in valued if r["_source_line"] in v["source_lines"])
        add(
            "bybit:card:" + str(r["_source_line"]),
            datetime.fromisoformat(r["Дата"] + "T" + r["Время"]).replace(
                tzinfo=timezone.utc
            ),
            [
                C(
                    "sell_fiat",
                    investment_account_id=ref("account", "exchange_source"),
                    bank_account_id=ref("account", "primary_cash"),
                    crypto_asset_id=ref(
                        "asset", "ton", TON if r["Актив"] == "TON" else USDT
                    ),
                    quantity=str(-D(r["Изменение"].replace(",", "."))),
                    fiat_currency_code="USD",
                    fiat_amount=match["pending_manual_amount"],
                    historical_value_in_base=match["historical_value_in_base"],
                    valuation_source="Confirmed Bybit card export and CBR historical rate",
                    defer_manual_expense=True,
                )
            ],
            dict(card=match),
            r["_source_line"],
        )

    lots = []
    for row in original:
        for c in row["commands"]:
            p = c["payload"]
            kind = c["kind"]
            if kind == "create_protocol" and p["position_type"] == "liquidity_pool":
                lp = p["metadata"]["lp_receipt"]
                lots.append(
                    dict(
                        event_id=lp["event_id"],
                        master=lp["master"],
                        q=D(lp["quantity"]),
                        a=p["crypto_asset_id"]["resource_ref"].split("asset:ton:")[1],
                        b=p["secondary_source_position_id"]["resource_ref"].split(
                            "position:main:ton:"
                        )[1],
                        custody="main",
                        open=True,
                    )
                )
            elif kind in ("close_protocol", "lp_custody"):
                lot = next(
                    (
                        x
                        for x in lots
                        if x["event_id"]
                        == p["position_id"]["resource_ref"].split("protocol:")[1]
                    ),
                    None,
                )
                if lot:
                    if kind == "close_protocol":
                        lot["open"] = False
                    else:
                        lot["custody"] = p["to_custody"]
    running = {
        k: D(v)
        for k, v in next(r for r in reversed(original) if r.get("event_no") == 300)[
            "expected_main"
        ].items()
    }

    def proto(n):
        return ref("protocol", events[n - 1]["event_id"])

    deposits = {p["mint_row"]: p for p in tonco["positions"]}
    tonco_actions = {r["row"]: (p, r) for p in tonco["positions"] for r in p["events"]}
    lending_supplies = {
        330: "350",
        341: "40",
        346: "350",
        364: "200",
        368: "60",
        371: "95",
        375: "75",
        377: "520",
        392: "71",
        397: "197",
        400: "80",
    }
    receipts = {324: "149.5", 342: "53.5", 367: "38.04451", 396: "197.679107"}
    tg_receipts = {
        325: (118, "1110"),
        378: (124, "317.882887"),
        385: (126, "303.347826"),
        393: (128, "139.195016"),
        398: (130, "193.513661"),
    }
    external_expenses = {r["event_no"]: r["quantity_TON"] for r in owner["decisions"]}
    bybit_out = {
        387: (TON, "10"),
        388: (TON, "20"),
        389: (TON, "16"),
        390: (TON, "29"),
        391: (TON, "57"),
        394: (USDT, "50"),
        395: (USDT, "89.195016"),
    }
    external = read(
        "crypto-task/chronological-rebuild/blocks/0201-0300/accepted/v1/evidence/intermediate-transactions.json",
        True,
    )["transactions"]
    intermediate_balance = D("0.432922511")
    for tx in sorted(external, key=lambda t: int(t["lt"])):
        if not (1734391192 < tx["utime"] <= events[399]["timestamp"]):
            continue
        assert not tx.get("out_msgs")
        incoming = D(tx["in_msg"].get("value", 0)) / 10**9
        after = D(tx["end_balance"]) / 10**9
        paid_fee = intermediate_balance + incoming - after
        assert paid_fee >= 0
        commands = [
            reward("intermediate", TON, incoming),
            fee("intermediate", TON, paid_fee),
        ]
        add(
            "intermediate:" + tx["hash"],
            datetime.fromtimestamp(tx["utime"], timezone.utc),
            commands,
            dict(transaction=tx, zero_cost_technical_receipt=True),
            int(tx["lt"]),
        )
        intermediate_balance = after
    for review in reviews:
        n = review["event_no"]
        ev = events[n - 1]
        v = net[n]
        cmds = []
        paid = D(0)
        received = D(0)
        evidence = dict(
            accepted_review=review, economic_review=econ[n], source=BASE + "ledger.json"
        )
        for a, q in v.items():
            running[a] = running.get(a, D(0)) + q
        rows = set(review["source_rows"])
        tc = next((p for r, p in deposits.items() if r in rows), None)
        tca = next((pr for r, pr in tonco_actions.items() if r in rows), None)
        if n in receipts:
            received = D(receipts[n])
            cmds = [
                transfer("exchange_source", "main", TON, received),
                fee("exchange_source", TON, "0.02"),
            ]
        elif n in tg_receipts:
            row, q = tg_receipts[n]
            cmds = [
                transfer("telegram", "main", USDT, q),
                fee("telegram", USDT, D(telegram[row]["quantity"]) - D(q)),
            ]
            evidence["telegram_source"] = telegram[row]
            if n == 378:
                cmds.insert(
                    0,
                    C(
                        "quantity_correction",
                        investment_account_id=ref("account", "telegram"),
                        crypto_asset_id=ref("asset", "ton", USDT),
                        quantity="0.04",
                        comment="Округление документных сумм Telegram: доступно 318,84 USDT, вывод по документу 318,88; без добавления затрат",
                    ),
                )
                evidence["quantity_correction"] = dict(
                    quantity="0.04",
                    asset="USDT",
                    reason="Accumulated rounded purchase amounts versus documented gross withdrawal",
                )

        elif n in bybit_out:
            a, q = bybit_out[n]
            cmds = [transfer("main", "exchange_source", a, q)]
            paid = D(q) if a == TON else D(0)
            receiving_fee = {
                389: "0.0000007",
                390: "0.00004171",
                391: "0.00004059",
            }.get(n)
            if receiving_fee:
                cmds.append(fee("exchange_source", TON, receiving_fee))
        elif n == 303:
            received = D(129)
            cmds = [
                transfer("intermediate", "main", TON, 129),
                fee("intermediate", TON, "0.002689550"),
            ]
        elif n in (304, 306):
            paid = D(75 if n == 304 else 74)
            cmds = [swap("main", TON, paid, HGRAM, v[HGRAM])]
        elif n == 307 or tc:
            if tc:
                qa = D(tc["deposit_raw"][0]) / 10**9
                qb = D(tc["deposit_raw"][1]) / 10**6
                b = USDT
                meta = dict(
                    position_nft=tc["address"],
                    position_index=tc["index"],
                    source_evidence=tc,
                )
            else:
                qa = D("73.094573254")
                qb = -v[HGRAM]
                b = HGRAM
                lp = next(m for m in v if m not in (TON, HGRAM))
                qlp = v[lp]
                meta = dict(
                    lp_receipt=dict(
                        master=lp,
                        quantity=str(qlp),
                        custody="main",
                        event_id=ev["event_id"],
                    )
                )
                lots.append(
                    dict(
                        event_id=ev["event_id"],
                        master=lp,
                        q=qlp,
                        a=TON,
                        b=b,
                        custody="main",
                        open=True,
                    )
                )
            paid = qa
            cmds = [
                C(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="TONCO" if tc else "STON.fi",
                    position_type="liquidity_pool",
                    asset_symbol="TON",
                    quantity=str(qa),
                    source_position_id=P("main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    secondary_source_position_id=P("main", b),
                    secondary_quantity=str(qb),
                    network_code="ton",
                    metadata=meta,
                )
            ]
        elif tca:
            p, action = tca
            if action["kind"] == "close":
                origin = next(
                    r["event_no"] for r in reviews if p["mint_row"] in r["source_rows"]
                )
                cmds.append(
                    C(
                        "close_protocol",
                        position_id=proto(origin),
                        return_quantity=str(D(action["capital_raw"][0]) / 10**9),
                        secondary_return_quantity=str(
                            D(action["capital_raw"][1]) / 10**6
                        ),
                        allocation_policy="net_composition",
                    )
                )
            for a, q, dec in [
                (TON, action["fees_raw"][0], 9),
                (USDT, action["fees_raw"][1], 6),
            ]:
                if q:
                    cmds.append(reward("main", a, D(q) / 10**dec))
            received = D(action["payout_raw"][0]) / 10**9
            evidence["tonco_decoded"] = action
        elif n in (319, 321, 370):
            lp = next(a for a, q in v.items() if q < 0 and a != TON)
            selected = [
                lot
                for lot in lots
                if lot["open"] and lot["master"] == lp and lot["custody"] == "main"
            ]
            assert sum(lot["q"] for lot in selected) == -v[lp], n
            received = {319: D("292.211982284"), 370: D("73.819220538")}.get(n, D(0))
            total = -v[lp]
            returned = {
                a: received if a == TON else v[a]
                for a in (selected[0]["a"], selected[0]["b"])
            }
            left = dict(returned)
            for i, lot in enumerate(selected):
                alloc = {
                    a: left[a]
                    if i == len(selected) - 1
                    else (q * lot["q"] / total).quantize(
                        D(1).scaleb(-assets[a]["decimals"])
                    )
                    for a, q in returned.items()
                }
                for a, q in alloc.items():
                    left[a] -= q
                cmds.append(
                    C(
                        "close_protocol",
                        position_id=ref("protocol", lot["event_id"]),
                        return_quantity=str(alloc[lot["a"]]),
                        secondary_return_quantity=str(alloc[lot["b"]]),
                        allocation_policy="net_composition",
                    )
                )
                lot["open"] = False
        elif n in (308, 316, 317, 369):
            lp = next(
                m["master"] for m in ledger if m["event_no"] == n and "LP" in m["asset"]
            )
            q = abs(v[lp])
            selected = [lot for lot in lots if lot["open"] and lot["master"] == lp]
            assert sum(lot["q"] for lot in selected) == q
            for lot in selected:
                dest = (
                    "0:e4b70ba128378cf07112171d70bc08ce5d460b9ee1a86f2b45ec1532405dadd5"
                    if n == 308
                    else "main"
                )
                cmds.append(
                    C(
                        "lp_custody",
                        position_id=ref("protocol", lot["event_id"]),
                        receipt_master=lp,
                        quantity=str(lot["q"]),
                        from_custody=lot["custody"],
                        to_custody=dest,
                    )
                )
                lot["custody"] = dest
            for a, q in v.items():
                if a != TON and a != lp and q > 0:
                    cmds.append(reward("main", a, q))
        elif n == 322:
            cmds = [
                C(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="swap.coffee",
                    position_type="staking",
                    asset_symbol="JETTON",
                    quantity="9000",
                    source_position_id=P("main", JETTON),
                    crypto_asset_id=ref("asset", "ton", JETTON),
                    network_code="ton",
                )
            ]
        elif n == 337:
            cmds = [
                C(
                    "close_protocol",
                    position_id=proto(246),
                    return_quantity="422.955524902",
                ),
                reward("main", JETTON, "18.036775944"),
            ]
        elif n == 352:
            cmds = [transfer("main", "intermediate", JETTON, "1480.341426703")]
        elif n in external_expenses:
            paid = D(external_expenses[n])
            cmds = [
                C(
                    "expense",
                    source_position_id=P("main"),
                    quantity=str(paid),
                    comment="Внешний расход по решению владельца",
                )
            ]
        elif n in (326, 330):
            a = USDT if n == 326 else TON
            q = "600" if n == 326 else "350"
            paid = D(q) if a == TON else D(0)
            cmds = [
                C(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="EVAA",
                    position_type="lending",
                    asset_symbol=assets[a]["symbol"],
                    quantity=q,
                    source_position_id=P("main", a),
                    crypto_asset_id=ref("asset", "ton", a),
                    network_code="ton",
                )
            ]
        elif n in lending_supplies:
            paid = D(lending_supplies[n])
            cmds = [
                C(
                    "top_up_protocol",
                    position_id=proto(330),
                    source_position_id=P("main"),
                    quantity=str(paid),
                )
            ]
        elif n in (327, 331, 347, 365):
            a = TON if n == 327 else USDT
            q = {327: "50", 331: "1058.469413", 347: "1050", 365: "800"}[n]
            cmds = [
                C(
                    "borrow",
                    position_id=proto(326 if n == 327 else 330),
                    borrowed_crypto_asset_id=ref("asset", "ton", a),
                    debt_qty=q,
                    funding_policy="components",
                )
            ]
            received = D(q) if a == TON else D(0)
        elif n == 328:
            paid = D("50.051166723")
            cmds = [
                C(
                    "accrue",
                    position_id=proto(326),
                    collateral_qty="0",
                    interest_qty="0.051166723",
                    interest_value_in_base="0",
                    collateral_before="600",
                    debt_before="50",
                ),
                C(
                    "repay",
                    position_id=proto(326),
                    source_position_id=P("main"),
                    repay_qty=str(paid),
                    interest_qty="0.051166723",
                ),
            ]
        elif n == 329:
            cmds = [
                C(
                    "close_protocol",
                    position_id=proto(326),
                    return_quantity="600.016938",
                )
            ]
        elif n == 373:
            # Contract v6 decoded quantities supersede old indexed-unit estimates.
            interest = (D("136.536187") * D("24.156985") / D("2932.626398")).quantize(
                D(".000001")
            )
            cmds = [
                C(
                    "accrue",
                    position_id=proto(330),
                    collateral_qty="0.484019883",
                    interest_qty="24.156985",
                    interest_value_in_base="0",
                    collateral_before="1095",
                    debt_before="2908.469413",
                ),
                C(
                    "liquidate",
                    position_id=proto(330),
                    collateral_qty="43.498503714",
                    debt_qty="136.536187",
                    interest_qty=str(interest),
                    collateral_fee_qty="0",
                    comment="Контракт EVAA v6; проценты распределены пропорционально телу и накопленным процентам",
                ),
                reward("main", TON, "0.020953967"),
            ]
            received = D("0.020953967")
        elif n == 386:
            # Router split: two recognized DeDust swaps plus the STON.fi -> Hipo
            # -> TONCO route. Count the wallet debit/output once across all routes.
            received = D("93.370890418")
            assert -v[USDT] == D("303.347826")
            cmds = [swap("main", USDT, "303.347826", TON, received)]
            evidence["aggregate_route"] = dict(
                source_USDT="303.347826",
                recognized_dedust_USDT=["162.593456", "125.130225"],
                stonfi_hgram_tonco_USDT="15.624145",
                tonco_TON="4.935971851",
                total_TON=str(received),
            )
        elif any(
            a["type"] == "JettonSwap" and a["status"] == "ok"
            for a in ev["raw"]["actions"]
        ):
            for action in ev["raw"]["actions"]:
                if action["type"] != "JettonSwap" or action["status"] != "ok":
                    continue
                raw_swap = action["JettonSwap"]

                def leg(side, raw_swap=raw_swap):
                    if raw_swap.get("ton_" + side):
                        return TON, D(raw_swap["ton_" + side]) / 10**9
                    token = raw_swap["jetton_master_" + side]
                    return (
                        TON
                        if token["symbol"] in ("pTON", "pGRAM")
                        else token["address"]
                    ), D(raw_swap["amount_" + side]) / 10 ** token["decimals"]

                a, qa = leg("in")
                b, qb = leg("out")
                cmds.append(swap("main", a, qa, b, qb))
                paid += qa if a == TON else D(0)
                received += qb if b == TON else D(0)
        else:
            for a, q in v.items():
                if a != TON and a not in exclusions and q > 0:
                    cmds.append(reward("main", a, q))
                elif a != TON and a not in exclusions and q < 0:
                    raise ValueError((n, "unmapped", a, q))
            if n in (361, 383):
                received = D("3.089540329" if n == 361 else "2.550574548")
                cmds.append(reward("main", TON, received))
        if n == 373:
            evidence["liquidation_policy"] = (
                "Proportional principal/interest settlement; minimum_collateral is slippage guard, NOT penalty. No unsupported separate penalty amount asserted."
            )
        if n == 400:
            cmds.insert(
                0,
                C(
                    "accrue",
                    position_id=proto(330),
                    collateral_qty="0.614390296",
                    interest_qty="0",
                    interest_value_in_base="0",
                    collateral_before="1914.985516169",
                    debt_before="2796.090211",
                ),
            )
            evidence["collateral_snapshot"] = dict(
                source="crypto-task/crypto-reconciliation/work/evaa-ton-contract-ledger/sources/trace-1357.json",
                supply_rate="816566038974",
                principal_after="2443892852773",
                token_quantity_after="1995.599906465",
                rounding="1 nanoTON flooring included in accrued net yield",
            )
        for c in cmds:
            if c["kind"] == "create_protocol":
                c["payload"].setdefault("metadata", {})["source_event_id"] = ev[
                    "event_id"
                ]
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
        if not cmds:
            cmds = [
                C("observation", comment="Техническое событие без финансового движения")
            ]
            evidence["zero_movement"] = all(
                q == 0 for a, q in v.items() if a not in exclusions
            )
        add(
            "main:" + ev["event_id"],
            datetime.fromtimestamp(ev["timestamp"], timezone.utc),
            cmds,
            evidence,
            int(ev["lt"]),
            event_no=n,
            expected_main={k: str(q) for k, q in running.items()},
        )
    for r in checkpoint["main_wallet_balances"]:
        if r["master"] not in exclusions:
            assert running.get(r["master"], D(0)) == D(r["quantity"]), r
    appended.sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    plan["rows"] += appended
    assert plan["rows"][: len(original)] == original
    assert plan["rows"] == sorted(
        plan["rows"], key=lambda r: (r["occurred_at"], r["order_in_timestamp"])
    )
    assert len({r["source_id"] for r in plan["rows"]}) == len(plan["rows"])
    trace = read(
        "crypto-task/crypto-reconciliation/work/evaa-ton-contract-ledger/sources/trace-1357.json",
        True,
    )
    tx = next(
        n["transaction"]
        for n in nodes(trace)
        if n["transaction"]["hash"]
        == "95a09acb929562956ee233b8bcf98dd47606472beea77040a92fa91dc20422d8"
    )
    assert tx["success"] and not tx["aborted"] and trace.get("emulated") is False
    _, bits, version, _, op, _ = decode_command(tx["in_msg"]["raw_body"])
    asset, amount, rate, _ = bits.u(256), bits.u(64), bits.u(64), bits.u(64)
    assert version == 6 and op == 0x11 and amount == 80000000000
    assert asset == int(hashlib.sha256(b"TON").hexdigest(), 16)
    assert rate == 816566038974 and 2443892852773 * rate // 10**12 == 1995599906465
    fixture = read(
        "infra/db/Scripts/budgeting/tests/crypto_accounting/evaa-liquidation-quantities.json"
    )["events"][0]
    assert (
        fixture["debt_before"] == "2932.626398"
        and fixture["debt_removed"] == "136.536187"
    )
    assert (
        fixture["collateral_before"] == "1095.484019883"
        and fixture["collateral_removed"] == "43.498503714"
    )

    plan["inputs"] += inputs + [
        dict(
            path=str(prefix),
            sha256=hashlib.sha256(prefix.read_bytes()).hexdigest(),
            commit=None,
        )
    ]
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
    plan["excluded_assets"] = exclusions
    plan["expected_accounts"] = {
        "telegram": {
            TON: "0.502474201",
            USDT: "0",
            dogs: str(D("103993.0468") - D(dogs_spent) + 25000),
            "service:telegram:MAJOR": "25.018",
            "service:telegram:HMSTR": "1540.5763",
        },
        "intermediate": {TON: "0.431698382", JETTON: "1485.654757282"},
        "exchange_source": {TON: "24.31566", USDT: "13.35146975"},
        "second": {JETTON: "5"},
        "fourth": {JETTON: "5"},
    }
    plan.pop("expected_telegram_usdt", None)
    plan["accepted_custody"] = []
    plan.pop("accepted_custody_after_200", None)
    plan["main_account_name"] = "История main — события 1–400"
    plan["summary"].update(
        block="0001-0400",
        total_events=400,
        total_movements=1358,
        compiled_contiguous_prefix=400,
        source_events=len(plan["rows"]),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
    )
    plan["summary"]["documented_funding_RUB"] = str(
        sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
    )
    plan["summary"]["new_funding"] = {
        "RUB": str(sum(D(r.get("funding_RUB", "0")) for r in appended))
    }
    plan["limitations"] += [
        "Owner confirmed 26812 DOGS -> 25.018 MAJOR on 2024-12-31.",
        "Telegram nominal rounding corrections +0.055245 and +0.04 USDT create no cash cost.",
        "EVAA v6 liquidation uses 136.536187 USDT debt reduction, not 139.322639 paid by liquidator including protocol gift.",
        "Liquidation cost split between principal and interest is proportional; separate penalty not quantified. minimum_collateral is NOT a penalty measure.",
        "EVAA collateral accrual and integer flooring give 1995.599906465 TON at event400, superseding deposit-minus-seizure 1994.501496287 in old report.",
        "EVAA debt 2796.090211 USDT is last measured at liquidation Feb3; later accrued interest not claimed measured on Mar11.",
        "Bybit card conversions keep 33.06 USD pending manual allocation, not crypto and not automatic expenses.",
    ]
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--dogs-spent")
    a = p.parse_args()
    result = build(a.prefix, a.dogs_spent)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(result["summary"])
