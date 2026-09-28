"""Source-backed checks for the first contiguous replay, including its gates."""
from decimal import Decimal
import unittest

from build_first_block_replay import build


class FirstBlockReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = build()

    def test_contiguous_prefix_and_full_remaining_register(self):
        self.assertEqual([r['event_no'] for r in self.plan['rows'] if 'event_no' in r], list(range(1, 12)))
        self.assertEqual([r['event_no'] for r in self.plan['events']], list(range(1, 101)))
        self.assertFalse(self.plan['summary']['block_closed'])
        self.assertEqual(self.plan['summary']['loaded'], 0)

    def test_funding_is_only_documented_purchases(self):
        purchases = [r for r in self.plan['rows'] if r.get('funding_RUB')]
        self.assertEqual(len(purchases), 15)
        for row in purchases:
            self.assertEqual([c['kind'] for c in row['commands']], ['bank_buy', 'bank_to_portfolio'])
        self.assertEqual(sum(Decimal(r['funding_RUB']) for r in purchases), Decimal('75508'))
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

    def test_farm_moves_receipt_without_new_capital(self):
        row = next(r for r in self.plan['rows'] if r.get('event_no') == 7)
        self.assertEqual([c['kind'] for c in row['commands']], ['lp_custody', 'fee'])
        self.assertEqual(row['commands'][0]['payload']['quantity'], '0.081245847')
        self.assertNotEqual(row['lp_receipt']['custody'], 'main')
        self.assertEqual(row['commands'][1]['payload']['quantity'], '0.104529001')
        self.assertEqual(Decimal(row['expected_main']['native TON']), Decimal('0.383920988'))
        self.assertEqual(Decimal(row['expected_main'][row['lp_receipt']['master']]), 0)

    def test_dependency_order_and_unknown_swap(self):
        rows = self.plan['rows']
        swap = next(r for r in rows if r['source_id'] == 'telegram:row:20')
        before = next(r for r in rows if r.get('event_no') == 7)
        after = next(r for r in rows if r.get('event_no') == 8)
        self.assertLess(rows.index(before), rows.index(swap))
        self.assertLess(rows.index(swap), rows.index(after))
        self.assertIsNone(swap['commands'][0]['payload']['value_in_base'])
        self.assertEqual(swap['commands'][0]['payload']['from_amount'], '2.396125799')

    def test_rounded_document_retained_and_no_extra_funding(self):
        row = next(r for r in self.plan['rows'] if r['source_id'] == 'telegram:row:21')
        self.assertEqual(row['evidence']['purchase']['quantity'], '290.32')
        self.assertEqual(row['commands'][0]['payload']['quantity'], '290.32258')
        self.assertIn('not_exact_purchase_document', row['evidence']['quantity_quality'])
        self.assertEqual(Decimal(row['funding_RUB']), Decimal('27000'))
        self.assertEqual([c['kind'] for c in row['commands']], ['bank_buy', 'bank_to_portfolio'])

    def test_second_pool_and_both_network_fees(self):
        rows = {r['event_no']: r for r in self.plan['rows'] if 'event_no' in r}
        self.assertEqual(rows[8]['commands'][1]['payload']['quantity'], '0.000008834')
        self.assertEqual(rows[9]['commands'][2]['payload']['quantity'], '0.000310038')
        self.assertEqual(rows[10]['commands'][0]['payload']['secondary_quantity'], '290.322534')
        self.assertEqual(rows[11]['commands'][0]['payload']['quantity'], '0.003082835')
        self.assertEqual(Decimal(rows[11]['expected_main']['native TON']), Decimal('96.590950100'))

    def test_reproducible(self):
        self.assertEqual(build(), self.plan)


if __name__ == '__main__':
    unittest.main()
