#!/usr/bin/env python3
"""Reconstruct wallet quantities and protocol actions from cached Arbitrum evidence.

No RUB valuation and no database writes. Native returns come from the full-precision
Arbiscan CSV; ERC20 quantities and gas come from RPC receipts, never rounded UI text.
"""

import argparse
from collections import Counter, defaultdict
import csv
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path

WALLET = "0x1e3bc9c5d563d64493eacd4e9dfa53c6375d29c1"
ZERO = "0x" + "0" * 40
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
V3 = "0xc36442b4a4522e871399cd717abdd847ab11fe88"
V4 = "0xd88f38f930b7952f2db2432cb002e7abbf3dd869"
POOL = "0x794a61358d6845594f94dc1db02a252b5b4814ad"
TOKENS = {
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": ("USDC", 6),
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": ("USDT0", 6),
    "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8": ("aWETH", 18),
    "0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6": ("debtUSDC", 6),
}
SUPPLY = "0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61"
BORROW = "0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0"
REPAY = "0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051"
INC = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f"
DEC = "0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4"
MODIFY = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec"
MINT = "0x458f5fa412d0f69b08dd84872b0215675cc67bc1d5b6fd93300a1c3878b86196"
BURN = "0x4cf25bc1d991c17529c25213d3cc0cda295eeaad5f13f361969b12ea48015f90"


def words(data):
    data = data[2:]
    assert len(data) % 64 == 0
    return [int(data[i : i + 64], 16) for i in range(0, len(data), 64)]


def address(word):
    return "0x" + word[-40:]


def signed(n):
    return n - 2**256 if n >= 2**255 else n


def amount(n, decimals=18):
    return format(D(n) / 10**decimals, "f")


def audit(directory):
    rows = json.loads((directory / "transactions.json").read_text())
    returns = defaultdict(int)
    with (directory / "internal-transactions-arbiscan.csv").open(
        encoding="utf-8-sig"
    ) as f:
        raw_internal = list(csv.DictReader(f))
    for row in raw_internal:
        assert row["To"].lower() == WALLET and row["Status"] == "Success"
        q, unit = row["Amount"].split()
        returns[row["Parent Transaction Hash"]] += int(
            D(q) * (10**18 if unit == "ETH" else 1)
        )
    assert len(raw_internal) == 15
    assert set(returns) <= {r["hash"] for r in rows}
    assert len(rows) == len({r["hash"] for r in rows}) == 40
    balances = defaultdict(int)
    liquidity = defaultdict(int)
    nft_events = defaultdict(list)
    journal = []
    gas_total = 0
    nonce_list = []
    for row in rows:
        tx, receipt = row["transaction"], row["receipt"]
        success = int(receipt["status"], 16) == 1
        own = tx["from"] == WALLET
        gas = (
            int(receipt["gasUsed"], 16) * int(receipt["effectiveGasPrice"], 16)
            if own
            else 0
        )
        if own:
            nonce_list.append(int(tx["nonce"], 16))
        gas_total += gas
        delta = defaultdict(int)
        delta["ETH"] = returns[row["hash"]] - gas
        if success:
            delta["ETH"] += int(tx["value"], 16) if tx["to"] == WALLET else 0
            delta["ETH"] -= int(tx["value"], 16) if own else 0
        else:
            assert not receipt["logs"] and not returns[row["hash"]]
        aave, lp, excluded = [], [], []
        for log in receipt["logs"]:
            topic, data = log["topics"][0], words(log["data"])
            contract = log["address"]
            if topic == TRANSFER and len(log["topics"]) == 3:
                sender, receiver = map(address, log["topics"][1:])
                sign = int(receiver == WALLET) - int(sender == WALLET)
                if sign:
                    if contract in TOKENS:
                        delta[TOKENS[contract][0]] += sign * data[0]
                    else:
                        assert (
                            contract == "0xfaf87e196a29969094be35dfb0ab9d0b8518db84"
                            and sign * data[0] == 100
                        ), "Unreviewed external token"
                        excluded.append(
                            dict(
                                contract=contract,
                                atomic=str(sign * data[0]),
                                reason="unsolicited token; outside accounting perimeter",
                            )
                        )
            if topic == TRANSFER and len(log["topics"]) == 4 and contract in (V3, V4):
                token_id = str(int(log["topics"][3], 16))
                nft_events[contract + ":" + token_id].append(row["hash"])
            if contract == POOL and topic in (SUPPLY, BORROW, REPAY):
                assert address(log["topics"][2]) == WALLET
                kind = {SUPPLY: "supply", BORROW: "borrow", REPAY: "repay"}[topic]
                aave.append(
                    dict(
                        kind=kind,
                        reserve=address(log["topics"][1]),
                        atomic=str(data[0] if topic == REPAY else data[1]),
                    )
                )
            if (
                contract in TOKENS
                and topic in (MINT, BURN)
                and address(log["topics"][2]) == WALLET
            ):
                aave.append(
                    dict(
                        kind="indexed_token_" + ("mint" if topic == MINT else "burn"),
                        token=TOKENS[contract][0],
                        event_amount_atomic=str(data[0]),
                        accrued_since_previous_action_atomic=str(data[1]),
                        index_ray=str(data[2]),
                    )
                )
            if contract == V3 and topic in (INC, DEC):
                key = contract + ":" + str(int(log["topics"][1], 16))
                change = data[0] * (1 if topic == INC else -1)
                liquidity[key] += change
                lp.append(
                    dict(
                        position=key,
                        liquidity_delta=str(change),
                        principal_amount0_atomic=str(data[1]),
                        principal_amount1_atomic=str(data[2]),
                    )
                )
            if topic == MODIFY:
                assert address(log["topics"][2]) == V4
                key = V4 + ":" + str(data[3])
                change = signed(data[2])
                liquidity[key] += change
                lp.append(
                    dict(
                        position=key,
                        liquidity_delta=str(change),
                        pool_id=log["topics"][1],
                    )
                )
        economic = {
            s: amount(q, 18 if s in ("ETH", "aWETH") else 6)
            for s, q in delta.items()
            if q
        }
        for s, q in delta.items():
            balances[s] += q
            assert balances[s] >= 0, (row["hash"], s, balances[s])
        method = tx["input"][:10]
        if excluded:
            assert not own and not any(delta.values())
            kind = "excluded_dust"
        elif not success:
            kind = "failed_gas_only"
        elif aave:
            kind = next(
                a["kind"] for a in aave if a["kind"] in ("supply", "borrow", "repay")
            )
        elif lp:
            kind = "lp_open" if int(lp[0]["liquidity_delta"]) > 0 else "lp_close"
        elif method == "0x095ea7b3":
            kind = "approval_gas_only"
        elif method == "0x3593564c":
            kind = "swap"
        else:
            kind = "bybit_out" if own else "bybit_in"
        journal.append(
            dict(
                hash=row["hash"],
                timestamp=row["timestamp"],
                kind=kind,
                gas_ETH=amount(gas),
                wallet_changes=economic,
                native_economic_ETH=amount(delta["ETH"] + gas),
                aave=aave,
                lp=lp,
                excluded=excluded,
                balances_atomic={k: str(v) for k, v in balances.items()},
            )
        )
    assert sorted(nonce_list) == list(range(len(nonce_list))), (
        "Missing own transaction nonce"
    )
    assert len(journal) - sum(r["kind"] == "excluded_dust" for r in journal) == 39
    assert len(liquidity) == 5 and all(v == 0 for v in liquidity.values())
    assert set(nft_events) == set(liquidity)
    live = json.loads((directory / "live-snapshot.json").read_text())
    assert live["nonce"] == len(nonce_list), "New own transaction outside inventory"
    # Interest-bearing token Transfer logs omit silent accrual: deliberately NOT
    # equated to live aWETH/debtUSDC balances.
    differences = {
        s: str(balances[s] - int(live["balances_atomic"][s]))
        for s in ("ETH", "USDC", "USDT0")
    }
    assert all(int(v) == 0 for v in differences.values()), differences
    boundary = json.loads((directory / "bybit-boundary.json").read_text())
    by_hash = {r["hash"]: r for r in journal}
    for entry in boundary:
        b = entry["row"]
        symbol = "USDT0" if b["Asset"] == "USDT" else b["Asset"]
        got = D(by_hash[b["Tx ID"]]["wallet_changes"][symbol])
        # Withdrawal into this wallet is incoming; the owner pays no gas on it.
        if b["Type"] == "Withdraw":
            assert got == D(b["Amount"]), (b, got)
        else:
            assert got == -D(b["Amount"]), (b, got)
    assert {r["hash"] for r in journal if r["kind"] in ("bybit_in", "bybit_out")} == {
        r["row"]["Tx ID"] for r in boundary
    }
    summary = dict(
        events=len(rows),
        counts=dict(Counter(r["kind"] for r in journal)),
        own_nonce_count=len(nonce_list),
        bybit_links_verified=len(boundary),
        gas_ETH=amount(gas_total),
        wallet={
            s: amount(balances[s], 18 if s == "ETH" else 6)
            for s in ("ETH", "USDC", "USDT0")
        },
        live_check=live,
        wallet_difference_atomic=differences,
        lp_liquidity=liquidity,
        limitations=[
            "RUB basis and loan components are not calculated by this quantity audit",
            "Live indexed Aave balances are not balances at the 2026-09-07 historical cutoff",
            "No database writes; chronological API replay still required",
        ],
    )
    (directory / "quantity-journal.json").write_text(
        json.dumps(journal, indent=2) + "\n"
    )
    (directory / "quantity-audit.json").write_text(json.dumps(summary, indent=2) + "\n")
    sources = {
        str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in directory.rglob("*")
        if p.is_file() and p.name != "manifest.json" and p.suffix != ".log"
    }
    (directory / "manifest.json").write_text(json.dumps(sources, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", type=Path, required=True)
    audit(p.parse_args().directory)
