"""Supplemental Aave February execution check, NOT a complete portfolio snapshot.

TON stops at 800 (November). This isolated scenario extends only Bybit/Arbitrum,
so its loan allocations must be recomputed when later TON movements are merged.
The historical November plan/state remain unchanged.
"""

import argparse
from collections import defaultdict, Counter
from datetime import datetime
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from build_arbitrum_plan import ETH, USDC, LOAN, WALLET, transfer, fee
from build_first_block_replay import USDT
from build_second_hundred_plan import command as C, position as P
from compile_main_commands import ref


def build(prefix, inventory, directory):
    plan = json.loads(prefix.read_text())
    start = max(r["occurred_at"] for r in plan["rows"])
    end = "2026-02-03T18:44:06+00:00"
    raw = inventory.read_bytes()
    bybit = json.loads(raw)
    cards = json.loads(
        Path(
            "outputs/crypto-card-valuations-2026-09-23/result-v1/valued-card-conversions.json"
        ).read_text()
    )
    journal = json.loads((directory / "quantity-journal.json").read_text())
    links = {
        x["tx_hash"]: x
        for x in json.loads((directory / "funding-links.json").read_text())["links"]
    }
    added = []
    keys = {"USDT": USDT, "USDC": USDC, "ETH": ETH}
    groups = defaultdict(list)

    def add(sid, t, commands, evidence, order=0, **extra):
        added.append(
            dict(
                source_id=sid,
                occurred_at=t,
                accounting_date=datetime.fromisoformat(t)
                .astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=order,
                commands=commands,
                evidence=evidence,
                **extra,
            )
        )

    for r in bybit:
        t = r["Дата"] + "T" + r["Время"] + ":00+00:00"
        if start < t <= end:
            groups[t].append(r)
    balance = {k: D(v) for k, v in plan["expected_accounts"]["exchange_source"].items()}
    for t, rs in sorted(groups.items()):
        trades = [r for r in rs if r["Тип"] == "TRADE"]
        if trades:
            sums = defaultdict(D)
            for r in trades:
                sums[r["Актив"]] += D(r["Изменение"].replace(",", "."))
            neg = [(a, -q) for a, q in sums.items() if q < 0]
            pos = [(a, q) for a, q in sums.items() if q > 0]
            assert len(neg) == len(pos) == 1
            (a, q), (b, v) = neg[0], pos[0]
            add(
                "bybit:trades:" + t,
                t,
                [
                    C(
                        "swap",
                        position_id=P("exchange_source", keys[a]),
                        from_amount=str(q),
                        to_crypto_asset_id=ref("asset", "ton", keys[b]),
                        to_amount=str(v),
                        basis_policy="carry",
                    )
                ],
                dict(source_rows=trades),
                max(r["_source_line"] for r in trades),
            )
        for r in rs:
            a = keys.get(r["Актив"])
            line = r["_source_line"]
            kind = r["Тип"]
            q = D(r["Изменение"].replace(",", "."))
            if not a:
                continue
            # User keeps Earn principal inside aggregate exchange custody.
            # Subscription/redemption changes subaccounts, not owned quantity.
            if not (kind == "Earn" and "Interest Distribution" not in r["Описание"]):
                balance[a] = balance.get(a, D(0)) + q
            cs = []
            extra = {}
            if kind == "Fiat":
                rub = r["₽"].replace(",", ".")
                cs = [
                    C(
                        "bank_buy",
                        bank_account_id=ref("account", "primary_cash"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=str(q),
                        fiat_currency_code="RUB",
                        fiat_amount=rub,
                    ),
                    C(
                        "bank_to_portfolio",
                        bank_account_id=ref("account", "primary_cash"),
                        investment_account_id=ref("account", "exchange_source"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=str(q),
                    ),
                ]
                extra = dict(funding_RUB=rub, funding_quality="known")
            elif q > 0 and (
                kind == "Airdrop"
                or kind == "Earn"
                and "Interest Distribution" in r["Описание"]
            ):
                cs = [
                    C(
                        "reward",
                        investment_account_id=ref("account", "exchange_source"),
                        crypto_asset_id=ref("asset", "ton", a),
                        quantity=str(q),
                    )
                ]
            elif kind == "Withdraw" and a == USDC:
                cs = [transfer("exchange_source", "ethereum_boundary", "USDC", -q)]
            elif kind == "Withdraw" and line == 597:
                assert q == -110 and a == USDT
                cs = [
                    C(
                        "expense",
                        source_position_id=P("exchange_source", USDT),
                        quantity="110",
                        comment="Оплата экскурсии — подтверждено владельцем",
                    )
                ]
            elif kind == "Deposit":
                assert line == 623 and a == USDT and q == 600
                fid = "friend:bybit:600"
                add(
                    fid,
                    t,
                    [
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
                    ],
                    dict(
                        owner_confirmation="600 USDT borrowed from friend; return outside this supplemental cutoff"
                    ),
                    line - 1,
                )
                cs = [
                    C(
                        "borrow",
                        position_id=ref("protocol", fid),
                        borrowed_crypto_asset_id=ref("asset", "ton", USDT),
                        debt_qty="600",
                        funding_policy="components",
                    )
                ]
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
            elif kind not in (
                "TRADE",
                "Earn",
                "Transfer out",
                "TRANSFER_OUT",
                "TRANSFER_IN",
                "Transfer in",
            ):
                raise AssertionError(r)
            if cs:
                add("bybit:row:" + str(line), t, cs, dict(source=r), line, **extra)
    coll = D(plan["expected_arbitrum"]["coll"])
    debt = D(plan["expected_arbitrum"]["debt"])
    body = D(plan["expected_arbitrum"]["body"])
    for r in journal:
        if not start < r["timestamp"] <= end:
            continue
        cs = []
        if r["kind"] == "bybit_in":
            link = links[r["hash"]]
            assert link["symbol"] == "USDC"
            cs = [
                transfer("ethereum_boundary", WALLET, "USDC", link["received"]),
                fee("ethereum_boundary", "USDC", link["exchange_fee"]),
            ]
        else:
            assert r["kind"] == "repay"
            q = -D(r["wallet_changes"]["USDC"])
            accrued = q + D(r["wallet_changes"]["debtUSDC"])
            before = debt + accrued
            interest = (q * (before - body) / before).quantize(D(".000001"))
            cs = [
                C(
                    "accrue",
                    position_id=ref("protocol", LOAN),
                    collateral_qty="0",
                    interest_qty=str(accrued),
                    interest_value_in_base="0",
                    collateral_before=str(coll),
                    debt_before=str(debt),
                ),
                C(
                    "repay",
                    position_id=ref("protocol", LOAN),
                    source_position_id=P(WALLET, USDC),
                    repay_qty=str(q),
                    interest_qty=str(interest),
                ),
                fee(WALLET, "ETH", r["gas_ETH"]),
            ]
            debt = before - q
            body -= q - interest
        add(
            "arbitrum:" + r["hash"],
            r["timestamp"],
            cs,
            dict(
                arbitrum=r,
                index_rounding="Previously rounded <= 0.000003 USDC does not create own cost",
            ),
        )
    plan["rows"] += added
    plan["rows"].sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    plan["expected_accounts"]["exchange_source"] = {
        k: str(v) for k, v in balance.items()
    }
    plan["expected_accounts"]["ethereum_boundary"][USDC] = "0"
    final = journal[-1]["balances_atomic"]
    plan["expected_accounts"][WALLET][ETH] = str(D(final["ETH"]) / 10**18)
    plan["expected_arbitrum"].update(debt=str(debt), body=str(body))
    plan["expected_bank_USD"] = str(
        sum(
            D(c["payload"]["fiat_amount"])
            for r in plan["rows"]
            for c in r["commands"]
            if c["kind"] == "sell_fiat" and c["payload"]["fiat_currency_code"] == "USD"
        )
    )
    plan["inputs"].append(
        dict(path=str(inventory), sha256=hashlib.sha256(raw).hexdigest())
    )
    plan["arbitrum_future_rows"] = []
    plan["diagnostic_only"] = True
    plan["diagnostic_reason"] = (
        "TON frozen at 800; February Aave/Bybit execution check only. Re-merge with future TON before publishing a portfolio snapshot."
    )
    plan["summary"].update(
        source_events=len(plan["rows"]),
        documented_funding_RUB=str(
            sum(D(r.get("funding_RUB", "0")) for r in plan["rows"])
        ),
        command_counts=dict(
            Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
        ),
    )
    plan["main_account_name"] = "Проверка Arbitrum до февраля — TON зафиксирован на 800"
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    result = build(
        a.prefix,
        Path("outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json"),
        Path("outputs/ethereum-inventory"),
    )
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(result["summary"])
