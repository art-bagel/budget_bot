"""Guards against wrong historical rates and duplicate/ambiguous card evidence."""
import csv
import json
from pathlib import Path
import tempfile
import unittest

from value_card_conversions import build


class CardEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.plan = self.root / 'plan'
        self.exports = self.root / 'exports'
        self.plan.mkdir()
        self.exports.mkdir()
        (self.plan / 'pending-card-allocations.json').write_text(json.dumps([{
            'source_key': 'card:1', 'date': '2025-01-04', 'time_as_in_source': '12:00',
            'currency': 'USD', 'pending_manual_amount': '10.20', 'crypto_debits': {'USDT': '10.4'},
        }]))
        self.xml = self.root / 'rates.xml'
        self.xml.write_text('<ValCurs ID="R01235"><Record Date="03.01.2025"><Nominal>1</Nominal><Value>90,1234</Value></Record><Record Date="05.01.2025"><Nominal>1</Nominal><Value>99</Value></Record></ValCurs>')
        self.rows = [dict(Uid='test', **{'Last 4 Digits': '1234', 'Type': kind, 'Status': 'SUCCESS',
                     'Transaction ID': key, 'Transaction Date & Time': time,
                     'Transaction Amount': '10.20', 'Currency': 'USD', 'Payment Currency': 'USD',
                     'Payment Amount': '10', 'Total Fee': '0.20', 'Merchant Name': merchant})
                     for kind, key, time, merchant in [
                         ('FREEZE', 'auth', '2025-01-04 12:00:01', 'SHOP'),
                         ('DEDUCT', 'settled', '2025-01-05 01:00:00', 'PROCESSOR * SHOP')]]
        self.write_rows()

    def write_rows(self, name='bybitCardTransactionHistory.csv', rows=None):
        with (self.exports / name).open('w') as f:
            f.write('metadata\n')
            w = csv.DictWriter(f, fieldnames=list(self.rows[0]))
            w.writeheader()
            w.writerows(self.rows if rows is None else rows)

    def run_build(self):
        return build(self.plan, self.exports, self.xml)

    def test_effective_rate_not_future_and_no_double_fee(self):
        r = self.run_build()['valued-card-conversions.json'][0]
        self.assertEqual(r['historical_value_in_base'], '919.26')
        self.assertEqual(r['rate_effective_date'], '2025-01-03')
        self.assertTrue(r['same_currency_fee_included_verified'])
        self.assertFalse(r['fee_additional_posting'])

    def test_identical_overlapping_export_is_not_extra_payment(self):
        self.write_rows('copy_bybitCardTransactionHistory.csv')
        self.assertEqual(self.run_build()['summary.json']['usd_total'], '10.20')

    def test_conflicting_duplicate_fails(self):
        changed = [dict(r) for r in self.rows]
        changed[1]['Total Fee'] = '0.30'
        self.write_rows('copy_bybitCardTransactionHistory.csv', changed)
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            self.run_build()

    def test_ambiguous_settlement_fails(self):
        self.rows.append({**self.rows[1], 'Transaction ID': 'another'})
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            self.run_build()

    def test_missing_rate_does_not_use_future_or_zero(self):
        self.xml.write_text('<ValCurs ID="R01235"><Record Date="05.01.2025"><Nominal>1</Nominal><Value>99</Value></Record></ValCurs>')
        with self.assertRaisesRegex(ValueError, 'Missing historical'):
            self.run_build()

    def test_wrong_fee_arithmetic_fails(self):
        self.rows[1]['Total Fee'] = '0.30'
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'arithmetic'):
            self.run_build()


if __name__ == '__main__':
    unittest.main()
