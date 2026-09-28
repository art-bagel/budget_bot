#!/usr/bin/env python3
"""Read-only, cached Arbitrum RPC evidence for an explicit transaction inventory."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

RPC = "https://arb1.arbitrum.io/rpc"


def collect(directory: Path, wallet: str):
    raw = directory / "rpc"
    raw.mkdir(parents=True, exist_ok=True)

    def call(method, params):
        payload = dict(jsonrpc="2.0", id=1, method=method, params=params)
        key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        path = raw / (key + ".json")
        if path.exists():
            return json.loads(path.read_text())["response"]["result"]
        proc = subprocess.run(
            [
                "curl",
                "--fail",
                "-sS",
                "--retry",
                "3",
                "--max-time",
                "40",
                RPC,
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                "@-",
            ],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            check=True,
        )
        response = json.loads(proc.stdout)
        if "error" in response or response.get("result") is None:
            raise RuntimeError((payload, response))
        path.write_text(
            json.dumps(dict(endpoint=RPC, request=payload, response=response), indent=2)
            + "\n"
        )
        return response["result"]

    def transaction(h):
        receipt = call("eth_getTransactionReceipt", [h])
        tx = call("eth_getTransactionByHash", [h])
        assert tx["hash"] == receipt["transactionHash"] == h
        block = receipt["blockNumber"]
        header = call("eth_getBlockByNumber", [block, False])
        return dict(
            hash=h,
            transaction=tx,
            receipt=receipt,
            timestamp=datetime.fromtimestamp(
                int(header["timestamp"], 16), timezone.utc
            ).isoformat(),
        )

    hashes = json.loads((directory / "hashes.json").read_text())
    assert len(hashes) == len(set(hashes))
    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = list(executor.map(transaction, hashes))
    rows.sort(
        key=lambda r: (
            int(r["receipt"]["blockNumber"], 16),
            int(r["receipt"]["transactionIndex"], 16),
        )
    )
    # Ensure deterministic ordering for the explicit transaction inventory.
    assert len({r["receipt"]["blockNumber"] for r in rows}) == len(rows)
    (directory / "transactions.json").write_text(json.dumps(rows, indent=2) + "\n")
    header = call("eth_getBlockByNumber", ["latest", False])
    block = header["number"]
    tokens = {
        "USDC": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "USDT0": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        "aWETH": "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8",
        "debtUSDC": "0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6",
    }
    balances = {
        name: str(
            int(
                call(
                    "eth_call",
                    [
                        dict(to=address, data="0x70a08231" + wallet[2:].rjust(64, "0")),
                        block,
                    ],
                ),
                16,
            )
        )
        for name, address in tokens.items()
    }
    balances["ETH"] = str(int(call("eth_getBalance", [wallet, block]), 16))
    nonce = int(call("eth_getTransactionCount", [wallet, block]), 16)
    snapshot = dict(
        block=block,
        timestamp=datetime.fromtimestamp(
            int(header["timestamp"], 16), timezone.utc
        ).isoformat(),
        balances_atomic=balances,
        nonce=nonce,
        purpose="Live independent check; NOT historical cutoff valuation",
    )
    (directory / "live-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Saved {len(rows)} transactions with receipts and block timestamps")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--wallet", required=True)
    args = parser.parse_args()
    collect(args.directory, args.wallet.lower())
