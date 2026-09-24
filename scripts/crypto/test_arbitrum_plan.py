"""Boundary regression checks using private reconstructed history when available."""

import json
from pathlib import Path
import tempfile
import unittest
from build_arbitrum_plan import build, ETH

ROOT = Path(__file__).resolve().parents[2]
PREFIX = ROOT / "outputs/crypto-eighth-block-dev/plan-800-raw.json"
SOURCE = ROOT / "outputs/ethereum-inventory"


@unittest.skipUnless(PREFIX.exists(), "Local private history required")
class ChronologyChecks(unittest.TestCase):
    def test_future_payments_never_change_november_snapshot(self):
        plan = build(PREFIX, SOURCE)
        self.assertEqual(len(plan["arbitrum_future_rows"]), 4)
        self.assertEqual(plan["expected_arbitrum"]["debt"], "330")
        self.assertTrue(all(r["occurred_at"] < "2025-11-17" for r in plan["rows"]))
        self.assertEqual(plan["expected_accounts"]["ethereum_boundary"][ETH], "0")
        # No own fiat invented by the Arbitrum merge.
        original = json.loads(PREFIX.read_text())
        self.assertEqual(
            [
                (r["source_id"], r["funding_RUB"])
                for r in plan["rows"]
                if "funding_RUB" in r
            ],
            [
                (r["source_id"], r["funding_RUB"])
                for r in original["rows"]
                if "funding_RUB" in r
            ],
        )

    def test_tail_keeps_earn_principal_in_combined_exchange_custody(self):
        from build_arbitrum_tail_check import build as tail
        from build_first_block_replay import USDT

        plan = tail(
            ROOT / "outputs/crypto-eighth-block-dev/plan-800.json",
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json",
            SOURCE,
        )
        # Statement funding account 0.06248405 plus Earn principal 449.134.
        self.assertEqual(
            plan["expected_accounts"]["exchange_source"][USDT], "449.19648405"
        )
        self.assertTrue(plan["diagnostic_only"])
        self.assertEqual(plan["arbitrum_future_rows"], [])

    def test_missing_exchange_funding_rejected(self):
        plan = json.loads(PREFIX.read_text())
        plan["rows"] = [r for r in plan["rows"] if r["source_id"] != "bybit:row:348"]
        with tempfile.TemporaryDirectory() as folder:
            prefix = Path(folder) / "prefix.json"
            prefix.write_text(json.dumps(plan))
            with self.assertRaises(AssertionError):
                build(prefix, SOURCE)

    def test_mismatched_arrival_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for name in (
                "quantity-journal.json",
                "funding-links.json",
                "transactions.json",
            ):
                (directory / name).write_bytes((SOURCE / name).read_bytes())
            data = json.loads((directory / "funding-links.json").read_text())
            data["links"][0]["received"] = "999"
            (directory / "funding-links.json").write_text(json.dumps(data))
            with self.assertRaises(AssertionError):
                build(PREFIX, directory)


if __name__ == "__main__":
    unittest.main()
