"""Mutation checks against the local, private Arbitrum evidence bundle."""

import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from audit_arbitrum_history import audit, WALLET

SOURCE = Path(__file__).resolve().parents[2] / "outputs/ethereum-inventory"


@unittest.skipUnless(
    (SOURCE / "live-snapshot.json").exists(), "Local evidence bundle required"
)
class EvidenceChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for name in (
            "transactions.json",
            "internal-transactions-arbiscan.csv",
            "live-snapshot.json",
            "bybit-boundary.json",
        ):
            shutil.copyfile(SOURCE / name, self.directory / name)

    def run_audit(self):
        with contextlib.redirect_stdout(io.StringIO()):
            audit(self.directory)

    def mutate(self, change):
        p = self.directory / "transactions.json"
        rows = json.loads(p.read_text())
        change(rows)
        p.write_text(json.dumps(rows))

    def test_original_and_repeat(self):
        self.run_audit()
        first = (self.directory / "quantity-journal.json").read_bytes()
        self.run_audit()
        self.assertEqual(first, (self.directory / "quantity-journal.json").read_bytes())

    def test_missing_approval_detected(self):
        def change(rows):
            rows.remove(
                next(
                    r
                    for r in rows
                    if r["transaction"]["input"].startswith("0x095ea7b3")
                )
            )

        self.mutate(change)
        with self.assertRaises(AssertionError):
            self.run_audit()

    def test_failed_value_cannot_be_posted(self):
        def change(rows):
            r = next(r for r in rows if r["receipt"]["status"] == "0x0")
            r["receipt"]["status"] = "0x1"

        self.mutate(change)
        with self.assertRaises(AssertionError):
            self.run_audit()

    def test_gas_unit_error_detected(self):
        def change(rows):
            r = next(r for r in rows if r["transaction"]["from"] == WALLET)
            r["receipt"]["gasUsed"] = hex(int(r["receipt"]["gasUsed"], 16) + 1)

        self.mutate(change)
        with self.assertRaises(AssertionError):
            self.run_audit()

    def test_missing_internal_return_detected(self):
        p = self.directory / "internal-transactions-arbiscan.csv"
        lines = p.read_text().splitlines()
        p.write_text("\n".join(lines[:-1]) + "\n")
        with self.assertRaises(AssertionError):
            self.run_audit()

    def test_exchange_amount_mismatch_detected(self):
        p = self.directory / "bybit-boundary.json"
        rows = json.loads(p.read_text())
        rows[0]["row"]["Amount"] = "999"
        p.write_text(json.dumps(rows))
        with self.assertRaises(AssertionError):
            self.run_audit()


if __name__ == "__main__":
    unittest.main()
