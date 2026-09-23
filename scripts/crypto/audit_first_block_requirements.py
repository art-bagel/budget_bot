"""Inventory the entire accepted hundred against replay capabilities, not postings."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from build_first_block_replay import BASE, PIN, build
from build_history_inventory import ROOT, git

GROUPS = {
    'staking_receipt_and_redemption': [12, 47, 53, 63, 64, 65],
    'evaa_collateral_debt_and_accrual': [13, 16, 30, 31],
    'battery_payment_and_refund': [14, 19],
    'unknown_receipt': [15],
    'lp_deposit': [4, 10, 17, 25, 36, 52, 60, 69, 83, 98],
    'lp_custody': [7, 11, 18, 26, 37, 62, 70, 99],
    'lp_return_and_separate_rewards': [84, 85, 86, 90, 93],
    'lp_redemption_two_assets': [87, 89, 91, 94],
    'telegram_source_transfer': [2, 8, 9, 21, 23, 24, 28, 29, 33, 34, 40, 41, 48, 49, 58, 67, 78, 96],
    'bybit_source_transfer': [20, 22],
    'own_outbound_transfer': [3, 6, 27, 72, 73, 76, 77],
    'swap_unknown_historical_value': [35, 59, 68, 81, 82, 92, 95, 97],
    'reward': [1, 57, 74, 88, 100],
    'unconfirmed_external_expense': [75],
    'technical_fee_only': [5, 32, 38, 39, 42, 43, 44, 45, 46, 50, 51, 54, 55, 56, 61, 66, 71, 79, 80],
}


def build_requirements():
    source = git('show', PIN + ':' + BASE + 'review.json')
    reviews = json.loads(source)
    events = json.loads((ROOT / 'outputs/crypto-history-inventory-2026-09-23-v2/main-events.json').read_text())[:100]
    movements = json.loads((ROOT / 'outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json').read_text())[:295]
    groups = {n: group for group, numbers in GROUPS.items() for n in numbers}
    assert Counter(n for numbers in GROUPS.values() for n in numbers) == Counter(range(1, 101))
    compiled = {r['event_no']: r for r in build()['rows'] if 'event_no' in r}
    rows = []
    for event, review in zip(events, reviews, strict=True):
        n = event['event_no']
        assert n == review['event_no']
        rows.append(dict(event_no=n, event_id=event['event_id'], group=groups[n],
            accepted_explanation=review['explanation'], source_rows=[r['source_row'] for r in movements if r['event_no'] == n],
            commands_compiled=n in compiled, posted=False,
            status='compiled_requires_replay_state' if n in compiled else 'requires_mapping_and_dependency_checks'))
    return dict(source_commit=PIN, review_sha256=hashlib.sha256(source).hexdigest(), events=rows,
        summary=dict(events=100, movements=295, compiled=len(compiled), unmapped=100-len(compiled),
                     groups=dict(Counter(r['group'] for r in rows))),
        dependencies=[
            'Telegram purchases, own returns, exact owner swap, estimated money and rounded quantities',
            'Bybit source acquisition and withdrawal costs: no legacy calculated basis as a new fiat purchase',
            'Unknown/estimated LP basis per leg, aggregated LP receipts, full redemption without invented reward',
            'Staking wrapper preserves basis; market swap remains a separate event type',
            'EVAA token debt from historical indexes; raw principal -490 is not USDT quantity',
            'Technical refunds carry consumed cost without becoming free rewards',
            'Intermediate wallet swap and remaining balances, second/fourth transfers',
            'Interleaved events 60/61 require original movement ordering or joint checkpoint',
        ])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = build_requirements()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['summary'], ensure_ascii=False))
