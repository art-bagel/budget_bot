"""Coverage and adversarial checks against locally restored immutable inputs."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from build_unified_journal import build, ROOT


class UnifiedJournalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.paths = [ROOT / 'outputs' / p for p in (
            'crypto-history-inventory-2026-09-23-v2', 'crypto-telegram-history-2026-09-23-v2',
            'crypto-related-history-2026-09-23-v1', 'crypto-cash-plan-2026-09-23-v4',
            'crypto-card-valuations-2026-09-23/result-v1')]
        if not all(p.exists() for p in cls.paths):
            raise unittest.SkipTest('Restore private source fixtures first')
        cls.result = build(*cls.paths)

    def mutate(self, index, file, change, error):
        with tempfile.TemporaryDirectory(prefix='crypto-journal-test-') as directory:
            folder = Path(directory) / 'input'
            shutil.copytree(self.paths[index], folder)
            path = folder / file
            data = json.loads(path.read_text())
            change(data)
            path.write_text(json.dumps(data))
            paths = list(self.paths)
            paths[index] = folder
            with self.assertRaisesRegex(ValueError, error):
                build(*paths)

    def test_exact_coverage(self):
        s = self.result['summary.json']
        self.assertEqual((s['main_events'], s['main_movements'], s['telegram_rows'], s['bybit_rows']), (1049, 2653, 132, 1017))
        self.assertEqual(s['source_claims'], 4871)
        flattened = [key for row in self.result['journal.json'] for key in row['claims']]
        self.assertEqual(len(flattened), len(set(flattened)))
        self.assertEqual(set(flattened), set(self.result['source-claims.json']))
        self.assertEqual(len(self.result['cross-source-links.json']), 31)

    def test_checkpoint_and_interleaving(self):
        self.assertEqual([r['event_no'] for r in self.result['quantity-checkpoints.json']], list(range(100, 1001, 100)) + [1049])
        self.assertEqual(len(self.result['movement-order.json']), 2653)
        self.assertEqual(len(self.result['interleaved-events.json']), 11)
        self.assertIn({'source_row': 141, 'event_no': 60}, self.result['interleaved-events.json'])

    def test_no_estimate_upgrade_or_auto_earn_reward(self):
        buys = [r['cash_trade'] for r in self.result['journal.json'] if r.get('cash_trade', {}).get('direction') == 'buy_fiat']
        self.assertEqual(len(buys), 150)
        self.assertEqual(sum(r['basis_quality'] == 'estimated' for r in buys), 12)
        for r in self.result['journal.json']:
            if r['journal_key'] == 'telegram:row:89':
                self.assertEqual(r['kind'], 'telegram_unresolved')
        self.assertFalse(self.result['summary.json']['legacy_basis_imported'])

    def test_duplicate_card_claim_rejected(self):
        self.mutate(4, 'valued-card-conversions.json', lambda x: x[1]['source_lines'].append(x[0]['source_lines'][0]), 'Duplicate source claim')

    def test_cash_chain_quantity_mismatch_rejected(self):
        def change(rows):
            next(r for r in rows if r['linked_main_event'])['quantity'] = '999999'
        self.mutate(3, 'cash-exchanges.json', change, 'does not match chain transfer')

    def test_broken_movement_rejected(self):
        self.mutate(0, 'main-movements.json', lambda x: x[2].update(before_atomic=999999), 'continuity|arithmetic')

    def test_mixed_source_versions_rejected(self):
        self.mutate(1, 'summary.json', lambda x: x.update(source_commit='wrong'), 'Mixed source versions')

    def test_reproducible(self):
        self.assertEqual(self.result, build(*self.paths))


if __name__ == '__main__':
    unittest.main()
