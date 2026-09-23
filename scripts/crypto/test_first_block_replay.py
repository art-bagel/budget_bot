"""Source-backed checks for the first contiguous replay, including its gates."""
from decimal import Decimal
import unittest

from build_first_block_replay import build


class FirstBlockReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = build()

    def test_contiguous_prefix_and_full_remaining_register(self):
        self.assertEqual([r['event_no'] for r in self.plan['rows'] if 'event_no' in r], list(range(1, 7)))
        self.assertEqual([r['event_no'] for r in self.plan['events']], list(range(1, 101)))
        self.assertFalse(self.plan['summary']['block_closed'])
        self.assertEqual(self.plan['summary']['loaded'], 0)

    def test_funding_is_only_documented_purchases(self):
        purchases = [r for r in self.plan['rows'] if r.get('funding_RUB')]
        self.assertEqual(len(purchases), 14)
        for row in purchases:
            self.assertEqual([c['kind'] for c in row['commands']], ['bank_buy', 'bank_to_portfolio'])
        self.assertEqual(sum(Decimal(r['funding_RUB']) for r in purchases), Decimal('48508'))
        before_first_transfer = [r for r in purchases if r['occurred_at'] < '2024-05-28T16:19:46+00:00']
        self.assertEqual(len(before_first_transfer), 13)
        self.assertEqual(sum(Decimal(r['funding_RUB']) for r in before_first_transfer), Decimal('38508'))

    def test_lp_is_not_duplicated_as_free_capital(self):
        lp = next(r for r in self.plan['rows'] if r.get('event_no') == 4)
        self.assertEqual([c['kind'] for c in lp['commands']], ['create_protocol', 'fee'])
        self.assertEqual(lp['commands'][0]['payload']['quantity'], '9.357406226')
        self.assertEqual(lp['commands'][0]['payload']['secondary_quantity'], '3622.931254785')
        self.assertEqual(lp['commands'][1]['payload']['quantity'], '0.118282781')
        self.assertEqual(lp['lp_receipt']['quantity'], '0.081245847')

    def test_final_quantities_from_original_ledger(self):
        final = next(r for r in self.plan['rows'] if r.get('event_no') == 6)
        self.assertEqual(Decimal(final['expected_main']['native TON']), Decimal('0.488449989'))
        self.assertIn('1849.068745215', final['expected_main'].values())

    def test_unknown_times_and_destination_are_explicit(self):
        r = next(r for r in self.plan['rows'] if r['source_id'] == 'telegram:row:5')
        self.assertEqual(r['evidence']['time_quality'], 'date_only_ordering_placeholder')
        r = next(r for r in self.plan['rows'] if r['source_id'] == 'telegram:row:12')
        self.assertIn('destination unresolved', r['evidence']['classification'])

    def test_reproducible(self):
        self.assertEqual(build(), self.plan)


if __name__ == '__main__':
    unittest.main()
