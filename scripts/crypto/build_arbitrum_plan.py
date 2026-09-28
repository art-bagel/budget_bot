"""Merge verified Arbitrum movements into TON chronology with carried funding units.

No balances or RUB costs are seeded. Exchange transfers reuse the previously
funded custody boundary. Future rows are retained separately, never backdated.
"""

import argparse
from collections import Counter
from datetime import datetime
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from build_first_block_replay import USDT
from build_second_hundred_plan import command as C, position as P
from compile_main_commands import ref

ETH = "service:bybit:ETH"
USDC = "service:bybit:USDC"
KEYS = {"ETH": ETH, "USDC": USDC, "USDT0": USDT}
WALLET = "arbitrum"
LOAN = "arbitrum:aave"


def asset(a):
    return ref("asset", "ton", KEYS[a])


def transfer(w, to, a, q):
    return C(
        "transfer",
        position_id=P(w, KEYS[a]),
        target_investment_account_id=ref("account", to),
        amount=str(q),
    )


def fee(w, a, q):
    return C("fee", source_position_id=P(w, KEYS[a]), quantity=str(q))


def build(prefix, directory):
    plan = json.loads(prefix.read_text())
    journal = json.loads((directory / "quantity-journal.json").read_text())
    links = {
        x["tx_hash"]: x
        for x in json.loads((directory / "funding-links.json").read_text())["links"]
    }
    cutoff = max(r["occurred_at"] for r in plan["rows"])
    plan["assets"][USDC] = dict(symbol="USDC", decimals=6, network_code="arbitrum")
    # Existing ETH boundary holds gross debits. Split fees there at the real arrival.
    roots = {r["source_id"]: r for r in plan["rows"]}
    lp = {}
    coll = debt = body = D(0)
    added, future = [], []
    for row in journal:
        if row["timestamp"] > cutoff:
            future.append(row)
            continue
        sid = "arbitrum:" + row["hash"]
        cmds = []
        deltas = {a: D(q) for a, q in row["wallet_changes"].items() if a in KEYS}
        deltas["ETH"] = D(row["native_economic_ETH"])
        kind = row["kind"]
        if kind == "bybit_in":
            link = links[row["hash"]]
            assert link["source_id"] in roots
            a = link["symbol"]
            assert D(link["received"]) == deltas[a]
            cmds = [
                transfer("ethereum_boundary", WALLET, a, link["received"]),
                fee("ethereum_boundary", a, link["exchange_fee"]),
            ]
        elif kind == "bybit_out":
            a, q = next((a, -q) for a, q in deltas.items() if a != "ETH" and q < 0)
            cmds = [transfer(WALLET, "exchange_source", a, q)]
        elif kind == "swap":
            a, q = next((a, -q) for a, q in deltas.items() if q < 0)
            b, out = next((a, q) for a, q in deltas.items() if q > 0)
            cmds = [
                C(
                    "swap",
                    position_id=P(WALLET, KEYS[a]),
                    from_amount=str(q),
                    to_crypto_asset_id=asset(b),
                    to_amount=str(out),
                    basis_policy="carry",
                )
            ]
        elif kind == "lp_open":
            nft = row["lp"][0]["position"]
            other = next(a for a, q in deltas.items() if a != "ETH" and q < 0)
            lp[nft] = (sid, other)
            cmds = [
                C(
                    "create_protocol",
                    investment_account_id=ref("account", WALLET),
                    protocol_name="Uniswap " + ("V4" if ":35543" in nft else "V3"),
                    position_type="liquidity_pool",
                    asset_symbol="ETH",
                    quantity=str(-deltas["ETH"]),
                    source_position_id=P(WALLET, ETH),
                    crypto_asset_id=asset("ETH"),
                    secondary_source_position_id=P(WALLET, KEYS[other]),
                    secondary_quantity=str(-deltas[other]),
                    network_code="arbitrum",
                    metadata=dict(source_event_id=sid, nft_position=nft),
                )
            ]
        elif kind == "lp_close":
            origin, other = lp[row["lp"][0]["position"]]
            cmds = [
                C(
                    "close_protocol",
                    position_id=ref("protocol", origin),
                    return_quantity=str(deltas["ETH"]),
                    secondary_return_quantity=str(deltas[other]),
                    allocation_policy="net_composition",
                )
            ]
        elif kind == "supply":
            q = -deltas["ETH"]
            if not coll:
                cmds = [
                    C(
                        "create_protocol",
                        investment_account_id=ref("account", WALLET),
                        protocol_name="Aave V3",
                        position_type="lending",
                        asset_symbol="ETH",
                        quantity=str(q),
                        source_position_id=P(WALLET, ETH),
                        crypto_asset_id=asset("ETH"),
                        network_code="arbitrum",
                        metadata=dict(source_event_id=LOAN),
                    )
                ]
            else:
                interest = sum(
                    D(a["accrued_since_previous_action_atomic"]) / 10**18
                    for a in row["aave"]
                    if a.get("token") == "aWETH"
                )
                cmds = [
                    C(
                        "accrue",
                        position_id=ref("protocol", LOAN),
                        collateral_qty=str(interest),
                        interest_qty="0",
                        interest_value_in_base="0",
                        collateral_before=str(coll),
                        debt_before=str(debt),
                    ),
                    C(
                        "top_up_protocol",
                        position_id=ref("protocol", LOAN),
                        source_position_id=P(WALLET, ETH),
                        quantity=str(q),
                    ),
                ]
                coll += interest
            coll += q
        elif kind == "borrow":
            q = deltas["USDC"]
            interest = sum(
                D(a["accrued_since_previous_action_atomic"]) / 10**6
                for a in row["aave"]
                if a.get("token") == "debtUSDC"
            )
            if interest:
                cmds.append(
                    C(
                        "accrue",
                        position_id=ref("protocol", LOAN),
                        collateral_qty="0",
                        interest_qty=str(interest),
                        interest_value_in_base="0",
                        collateral_before=str(coll),
                        debt_before=str(debt),
                    )
                )
            cmds.append(
                C(
                    "borrow",
                    position_id=ref("protocol", LOAN),
                    borrowed_crypto_asset_id=asset("USDC"),
                    debt_qty=str(q),
                    funding_policy="components",
                )
            )
            debt += interest + q
            body += q
        elif kind == "repay":
            q = -deltas["USDC"]
            # First cycle is paid in full to within one micro-USDC; accepted dust policy.
            assert row["timestamp"].startswith("2025-09-15"), (
                "Future repayments require chronological Bybit continuation"
            )
            assert body == 250 and q == D("253.874945")
            cmds = [
                C(
                    "accrue",
                    position_id=ref("protocol", LOAN),
                    collateral_qty="0",
                    interest_qty=str(q - debt),
                    interest_value_in_base="0",
                    collateral_before=str(coll),
                    debt_before=str(debt),
                ),
                C(
                    "repay",
                    position_id=ref("protocol", LOAN),
                    source_position_id=P(WALLET, USDC),
                    repay_qty=str(q),
                    interest_qty=str(q - body),
                ),
            ]
            debt = body = D(0)
        else:
            assert kind in ("approval_gas_only", "failed_gas_only", "excluded_dust"), (
                kind
            )
        if D(row["gas_ETH"]):
            cmds.append(fee(WALLET, "ETH", row["gas_ETH"]))
        if not cmds:
            cmds = [
                C(
                    "observation",
                    comment="Посторонний токен исключён из учёта; подтверждённых вложений нет",
                )
            ]
        stamp = datetime.fromisoformat(row["timestamp"])
        added.append(
            dict(
                source_id=sid,
                occurred_at=row["timestamp"],
                accounting_date=stamp.astimezone(ZoneInfo("Europe/Moscow"))
                .date()
                .isoformat(),
                order_in_timestamp=0,
                commands=cmds,
                evidence=dict(
                    arbitrum=row,
                    dust_policy="September Aave residual <= 0.000002 USDC rounded away; no own capital invented",
                    swap_policy="Net wallet execution, router fees included in net exchange; gas separate",
                ),
            )
        )
    for row in added:
        if row["evidence"]["arbitrum"]["excluded"]:
            row["evidence"]["excluded_token_movements"] = row["evidence"]["arbitrum"][
                "excluded"
            ]
    plan["close_block"] = plan["summary"]["compiled_contiguous_prefix"] == 800
    plan["rows"] += added
    plan["rows"].sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    assert len({r["source_id"] for r in plan["rows"]}) == len(plan["rows"])
    last = next(r for r in reversed(journal) if r["timestamp"] <= cutoff)
    plan["expected_accounts"][WALLET] = {
        KEYS[a]: str(
            D(last["balances_atomic"].get(a, 0)) / 10 ** (18 if a == "ETH" else 6)
        )
        for a in KEYS
    }
    plan["expected_accounts"]["ethereum_boundary"] = {ETH: "0"}
    plan["expected_arbitrum"] = dict(
        coll=str(coll),
        debt=str(debt),
        body=str(body),
        collateral_as_of="2025-06-12: last balance-changing supply; subsequent passive yield not yet indexed",
    )
    plan.setdefault("account_display_names", {})[WALLET] = "Arbitrum — основной кошелёк"
    plan["summary"]["source_events"] = len(plan["rows"])
    plan["summary"]["command_counts"] = dict(
        Counter(c["kind"] for r in plan["rows"] for c in r["commands"])
    )
    plan["summary"]["first_unimplemented_kind"] = "Next TON chronological block"
    plan["arbitrum_future_rows"] = future
    for name in ("quantity-journal.json", "funding-links.json", "transactions.json"):
        p = directory / name
        plan["inputs"].append(
            dict(path=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        )
    plan["limitations"].append(
        "Aave passive collateral yield after June and debt interest after October require a historical index checkpoint; no later snapshot is backdated."
    )
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", type=Path, required=True)
    p.add_argument("--directory", type=Path, default=Path("outputs/ethereum-inventory"))
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    result = build(args.prefix, args.directory)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(result["summary"])
