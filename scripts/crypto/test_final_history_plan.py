"""Regression checks for the private final history, skipped without its evidence."""

import json
from decimal import Decimal as D
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import build_final_history_plan as final

ROOT = Path(__file__).resolve().parents[2]
PREFIX = ROOT / "outputs/crypto-eighth-block-dev/plan-800.json"


@unittest.skipUnless(PREFIX.exists(), "Local private history required")
class FinalHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = final.build(PREFIX)
        cls.rows = {r["event_no"]: r for r in cls.plan["rows"] if "event_no" in r}

    def test_prefix_immutable_and_all_events_present_once(self):
        old = json.loads(PREFIX.read_text())
        self.assertEqual(self.plan["rows"][: len(old["rows"])], old["rows"])
        self.assertEqual(set(self.rows), set(range(1, 1050)))
        self.assertEqual(
            len({r["source_id"] for r in self.plan["rows"]}), len(self.plan["rows"])
        )
        self.assertTrue(all(r["commands"] for r in self.plan["rows"]))
        self.assertNotIn("diagnostic_only", self.plan)
        self.assertEqual(self.plan["arbitrum_future_rows"], [])

    def test_evaa_excess_return_does_not_become_repayment(self):
        for n, net in [(1012, "647.822304"), (1013, "684.189954")]:
            row = self.rows[n]
            repay = next(c["payload"] for c in row["commands"] if c["kind"] == "repay")
            self.assertEqual(D(repay["repay_qty"]), D(net))
            self.assertGreater(D(row["evidence"]["evaa"]["actual"]) / 10**6, D(net))
        for loan in self.plan["expected_evaa"].values():
            self.assertTrue(all(D(v) == 0 for v in loan.values()))

    def test_lp_exit_carries_cost_and_both_stake_returns_match_contract(self):
        closes = [
            c["payload"]
            for c in self.rows[854]["commands"]
            if c["kind"] == "close_protocol"
        ]
        self.assertEqual(sum(D(c["return_quantity"]) for c in closes), D("257.780407"))
        self.assertEqual(
            sum(D(c["secondary_return_quantity"]) for c in closes), D("4909.909474201")
        )
        self.assertTrue(
            all(c["allocation_policy"] == "net_composition" for c in closes)
        )
        self.assertEqual(self.rows[857]["evidence"]["staking_deposit_event"], 408)
        self.assertEqual(self.rows[1027]["evidence"]["staking_deposit_event"], 595)

    def test_friend_loans_are_not_own_funding(self):
        byid = {r["source_id"]: r for r in self.plan["rows"]}
        for line in [623, 688]:
            self.assertNotIn("funding_RUB", byid["bybit:row:" + str(line)])
            self.assertEqual(
                byid["bybit:row:" + str(line)]["commands"][0]["kind"], "borrow"
            )
        for line in [652, 696]:
            self.assertEqual(
                byid["bybit:row:" + str(line)]["commands"][0]["kind"], "repay"
            )

    def test_failed_evaa_reply_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = json.loads((final.SOURCES / "trace-868.json").read_text())
            for node in final.nodes(trace):
                node["transaction"]["success"] = False
            Path(directory, "trace-868.json").write_text(json.dumps(trace))
            with patch.object(final, "SOURCES", Path(directory)):
                with self.assertRaises(AssertionError):
                    final.decode_evaa(868)


if __name__ == "__main__":
    unittest.main()
