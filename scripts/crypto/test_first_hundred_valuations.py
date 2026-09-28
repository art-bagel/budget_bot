"""Reference valuation cannot silently use a wrong day, live quote or zero rate."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from value_first_hundred import USDT, build

FIXTURES = Path(__file__).parent / 'fixtures/first-hundred-market'


def plan():
    rows = []
    for n in range(13):
        rows.append(dict(source_id=str(n), occurred_at='2024-06-12T05:41:00+00:00', evidence={}, commands=[dict(kind='swap', payload=dict(
            position_id={'resource_ref': 'position:main:ton:' + USDT}, from_amount='10',
            to_crypto_asset_id={'resource_ref': 'asset:ton:native TON'}, to_amount='1', value_in_base=None))]))
    return dict(rows=rows, inputs=[], limitations=[], summary={})


class ReferenceValuations(unittest.TestCase):
    def test_source_plan_immutable_and_all_swaps_explicitly_estimated(self):
        original = plan()
        before = deepcopy(original)
        result = build(original, FIXTURES)
        self.assertEqual(original, before)
        self.assertEqual(len(result['reference_valuations']), 13)
        for row in result['rows']:
            p = row['commands'][0]['payload']
            self.assertEqual(p['valuation_quality'], 'estimated')
            self.assertEqual(p['value_in_base'], '890.21')
            self.assertIn('not executed RUB trade', p['valuation_source'])

    def test_exact_minute_and_missing_rate_fail_closed(self):
        original = plan()
        p = original['rows'][0]['commands'][0]['payload']
        p['position_id']['resource_ref'] = 'position:main:ton:native TON'
        result = build(original, FIXTURES)
        self.assertEqual(result['reference_valuations'][0]['ton_usdt'], '7.0446')
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copytree(FIXTURES, tmp, dirs_exist_ok=True)
            path = Path(tmp) / 'gram-1718170860000.json'
            quote = json.loads(path.read_text())
            quote['result']['list'][0][0] = '1718170920000'
            path.write_text(json.dumps(quote))
            with self.assertRaisesRegex(ValueError, 'exact historical minute'):
                build(original, Path(tmp))
        original = plan()
        original['rows'][0]['occurred_at'] = '2024-05-01T00:00:00+00:00'
        with self.assertRaisesRegex(ValueError, 'Missing effective CBR'):
            build(original, FIXTURES)


if __name__ == '__main__':
    unittest.main()
