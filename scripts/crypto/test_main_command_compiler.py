"""Verify quantity gates, identity and resource binding of main command plans."""
import copy
import unittest

from compile_main_commands import ROOT, bind_plan_commands, build


class MainCompilerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = ROOT / 'outputs/crypto-history-inventory-2026-09-23-v2'
        cls.unified = ROOT / 'outputs/crypto-unified-journal-2026-09-23-v3'
        if not cls.inventory.exists() or not cls.unified.exists():
            raise unittest.SkipTest('Restore private source fixtures first')
        cls.result = build(cls.inventory, cls.unified)
        cls.plans = {p['event_no']: p for p in cls.result['main-command-plans.json']}

    def test_main_coverage_and_counts(self):
        self.assertEqual(set(self.plans), set(range(1, 1050)))
        self.assertEqual(self.result['summary.json']['quantity_reconciled_events'], 171)
        self.assertEqual(sum(self.result['summary.json']['complete_command_counts'].values()), 342)

    def test_blocked_partial_event_cannot_bind(self):
        p = next(p for p in self.plans.values() if p['blockers'] and p['commands'])
        with self.assertRaisesRegex(ValueError, 'blocked or partial'):
            bind_plan_commands(p, {})

    def test_missing_or_boolean_binding_rejected(self):
        p = self.plans[501]
        with self.assertRaisesRegex(ValueError, 'Missing or invalid'):
            bind_plan_commands(p, {})
        refs = [v['resource_ref'] for c in p['commands'] for v in c['payload'].values() if isinstance(v, dict)]
        with self.assertRaisesRegex(ValueError, 'Missing or invalid'):
            bind_plan_commands(p, dict.fromkeys(refs, True))
        bound = bind_plan_commands(p, dict.fromkeys(refs, 123))
        self.assertEqual(bound[0]['payload']['source_position_id'], 123)

    def test_stars_and_own_transfer_not_reward(self):
        self.assertEqual([c['kind'] for c in self.plans[501]['commands']], ['expense', 'fee'])
        self.assertEqual([c['kind'] for c in self.plans[502]['commands']], ['transfer', 'fee'])
        self.assertEqual(self.plans[502]['commands'][0]['payload']['amount'], '30.000000000')

    def test_rewards_keep_owner_uncertainty(self):
        for n, qty in [(606, '52.000000000'), (664, '61.000000000')]:
            plan = self.plans[n]
            self.assertFalse(plan['blockers'])
            self.assertEqual(plan['commands'][0]['kind'], 'reward')
            self.assertEqual(plan['commands'][0]['payload']['quantity'], qty)
            self.assertEqual(plan['evidence'][0]['confidence'], 'OWNER_RECOLLECTION_NOT_DOCUMENTARY_CONFIRMATION')

    def test_unknown_swaps_not_carried_old_basis(self):
        swaps = [c for p in self.plans.values() for c in p['commands'] if c['kind'] == 'swap']
        self.assertEqual(len(swaps), 95)
        self.assertTrue(all(c['payload']['value_in_base'] is None for c in swaps))
        for p in self.plans.values():
            if p['status'].startswith('quantity_reconciled'):
                self.assertFalse(p['unexplained_atomic'])

    def test_binding_does_not_mutate_plan(self):
        p = self.plans[501]
        original = copy.deepcopy(p)
        refs = [v['resource_ref'] for c in p['commands'] for v in c['payload'].values() if isinstance(v, dict)]
        bind_plan_commands(p, dict.fromkeys(refs, 123))
        self.assertEqual(p, original)

    def test_reproducible(self):
        self.assertEqual(self.result, build(self.inventory, self.unified))


if __name__ == '__main__':
    unittest.main()
