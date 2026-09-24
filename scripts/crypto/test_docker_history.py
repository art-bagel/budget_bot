"""Regression checks for replacement funding and fixed-price server payments."""

from collections import defaultdict
from decimal import Decimal as D
import json
import unittest

from prepare_docker_history import ROOT, corrected_plan


class DockerHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "outputs/crypto-final-block-dev/plan-1049.json"
        if not path.exists():
            raise unittest.SkipTest("Private historical plan not present")
        cls.original = json.loads(path.read_text())
        cls.plan = corrected_plan(cls.original)

    def test_each_payment_is_2835_including_split_receipts(self):
        groups = defaultdict(lambda: D(0))
        changes = self.plan["docker_migration"]["server_corrections"]
        for c in changes:
            groups[c["server_date"]] += D(c["actual_RUB"])
        self.assertEqual(len(changes), 17)
        self.assertEqual(len(groups), 16)
        self.assertEqual(set(groups.values()), {D("2835")})
        self.assertEqual(groups["2025-10-24"], D("2835"))

    def test_no_quantity_change_or_duplicate_august_swap(self):
        self.assertEqual(len(self.plan["rows"]), len(self.original["rows"]))
        for old, new in zip(self.original["rows"], self.plan["rows"], strict=True):
            self.assertEqual(old["source_id"], new["source_id"])
            self.assertEqual(old.get("expected_main"), new.get("expected_main"))
            self.assertEqual(len(old["commands"]), len(new["commands"]))
            for a, b in zip(old["commands"], new["commands"], strict=True):
                self.assertEqual(a["kind"], b["kind"])
                for key in ["quantity", "from_amount", "to_amount", "amount"]:
                    self.assertEqual(a["payload"].get(key), b["payload"].get(key))

    def test_exact_funding_replaces_estimates_not_income(self):
        total = sum(D(r.get("funding_RUB", "0")) for r in self.plan["rows"])
        self.assertEqual(total, D("2476475.43"))
        self.assertEqual(total - D("228671"), D("2247804.43"))
        self.assertEqual(
            sum(D(r.get("funding_RUB", "0")) for r in self.original["rows"]),
            D("2481653.33"),
        )
        self.assertFalse(
            any(c["kind"] == "income" for r in self.plan["rows"] for c in r["commands"])
        )


if __name__ == "__main__":
    unittest.main()
