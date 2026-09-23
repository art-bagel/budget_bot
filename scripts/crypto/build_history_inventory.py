"""Build read-only source inventory for the fixed 1049-event reconstruction.

Uses immutable Git blobs, not old calculated cost vectors. Local financial output
must remain under ignored outputs/. No database writes or accounting commands.
"""
import argparse
from collections import Counter, defaultdict
from decimal import Decimal
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BLOCKS = [('0001-0100', 'v1'), ('0101-0200', 'v2'), ('0201-0300', 'v1'),
          ('0301-0400', 'v2'), ('0401-0500', 'v1'), ('0501-0600', 'v1'),
          ('0601-0700', 'v1'), ('0701-0800', 'v1'), ('0801-0900', 'v1'),
          ('0901-1049', 'v1')]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def quantity(atomic, decimals):
    if type(atomic) is not int or type(decimals) is not int or decimals < 0:
        raise ValueError('Expected integer atomic quantity and decimals')
    digits = str(abs(atomic)).zfill(decimals + 1)
    return ('-' if atomic < 0 else '') + (digits[:-decimals] + '.' + digits[-decimals:] if decimals else digits)


def build(ref, bybit_path):
    commit = git('rev-parse', '--verify', ref + '^{commit}').decode().strip()
    inputs = []

    def read(path):
        raw = git('show', commit + ':' + path)
        inputs.append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    events, movements, blocks = [], [], []
    actions = Counter()
    excluded = 0
    for block, version in BLOCKS:
        prefix = f'crypto-task/chronological-rebuild/blocks/{block}/accepted/{version}/'
        source = read(prefix + 'events-source.json')
        ledger = read(prefix + 'ledger.json')
        start, end = map(int, block.split('-'))
        ids = {row['event_id']: row['event_no'] for row in ledger}
        assert set(ids.values()) == set(range(start, end + 1)), block
        assert len(source) == end - start + 1 and len({e['event_id'] for e in source}) == len(source), block
        assert set(ids) == {e['event_id'] for e in source}, block
        for event in source:
            event_no = ids[event['event_id']]
            actions.update(a['type'] for a in event['actions'])
            events.append({'event_no': event_no, 'event_id': event['event_id'],
                'timestamp': event['timestamp'], 'lt': str(event['lt']),
                'source': prefix + 'events-source.json', 'raw': event,
                'posting_status': 'not_mapped'})
        for row in ledger:
            assert ids[row['event_id']] == row['event_no']
            is_excluded = bool(row.get('excluded_from_financial_perimeter', False))
            excluded += is_excluded
            movements.append({**row, 'quantity_delta': (None if is_excluded and row['delta_atomic'] is None
                    else quantity(row['delta_atomic'], row['decimals'])),
                'excluded_from_financial_perimeter': is_excluded, 'source': prefix + 'ledger.json'})
        blocks.append({'block': block, 'version': version, 'events': len(source), 'movements': len(ledger)})
    events.sort(key=lambda e: e['event_no'])
    movements.sort(key=lambda m: m['source_row'])
    assert [e['event_no'] for e in events] == list(range(1, 1050))
    assert len({e['event_id'] for e in events}) == 1049
    assert [m['source_row'] for m in movements] == list(range(1, 2654))
    # Keep every row, including scam/NFT exclusions; quantities are not silently dropped.
    issues = []
    previous = {}
    for row in movements:
        if row['excluded_from_financial_perimeter'] and row['delta_atomic'] is None:
            assert row['before_atomic'] is None and row['after_atomic'] is None
            continue
        for field in ('before_atomic', 'after_atomic'):
            assert type(row[field]) is int, (row['source_row'], field)
        if row['before_atomic'] + row['delta_atomic'] != row['after_atomic']:
            issues.append({'kind': 'row_arithmetic', 'source_row': row['source_row']})
        master = row['master']
        if master in previous and previous[master] != row['before_atomic']:
            issues.append({'kind': 'balance_continuity', 'source_row': row['source_row'], 'asset': row['asset']})
        previous[master] = row['after_atomic']
    for left, right in zip(events, events[1:], strict=False):
        if (left['timestamp'], int(left['lt'])) > (right['timestamp'], int(right['lt'])):
            issues.append({'kind': 'source_order', 'event_no': right['event_no']})

    raw = bybit_path.read_bytes()
    bybit = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';'))
    inputs.append({'path': str(bybit_path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
    groups = defaultdict(list)
    fiat = []
    for line, row in enumerate(bybit, 2):
        row['_source_line'] = line
        row['_posting_status'] = 'not_mapped'
        if row['Тип'] == 'Fiat':
            fiat.append({'source_line': line, 'asset': row['Актив'],
                'quantity': str(Decimal(row['Изменение'].replace(',', '.'))),
                'currency': 'RUB', 'amount': str(Decimal(row['₽'].replace(',', '.'))),
                'date': row['Дата'], 'time_as_in_source': row['Время'], 'description': row['Описание']})
        if row['Тип'] == 'TRADE':
            groups[(row['Дата'], row['Время'], row['Счёт'])].append(row)
    trade_groups = []
    for key, rows in sorted(groups.items()):
        net = defaultdict(Decimal)
        directions = defaultdict(set)
        for row in rows:
            amount = Decimal(row['Изменение'].replace(',', '.'))
            net[row['Актив']] += amount
            directions[row['Актив']].add(1 if amount > 0 else -1 if amount < 0 else 0)
        single_direction = all(len(v) == 1 and 0 not in v for v in directions.values())
        net_pair = len(net) == 2 and sum(v > 0 for v in net.values()) == sum(v < 0 for v in net.values()) == 1
        positives = sum(Decimal(r['Изменение'].replace(',', '.')) > 0 for r in rows)
        negatives = sum(Decimal(r['Изменение'].replace(',', '.')) < 0 for r in rows)
        trade_groups.append({'date': key[0], 'time': key[1], 'account': key[2],
            'source_lines': [r['_source_line'] for r in rows], 'positive_legs': positives,
            'negative_legs': negatives, 'rows': len(rows),
            'simple_pair_candidate': len(rows) == 2 and positives == negatives == 1,
            'net_quantities': {k: str(v) for k, v in sorted(net.items())},
            'net_pair_candidate': single_direction and net_pair,
            'grouping_status': 'candidate_only_preserve_source_legs_and_verify_fees_order',
            'valuation_status': 'historical_base_currency_quote_not_established'})
    sales_path = 'crypto-task/chronological-rebuild/amendments/2026-09-19-friend-sale-proceeds/cash-proceeds-register.json'
    sales = read(sales_path)
    # Only confirmed proceeds, never legacy calculated cost/profit from that register.
    sales = [{'event_no': r['event'], 'date_msk': r['date_msk'], 'quantity': r['TON'],
              'asset': 'TON', 'currency': 'RUB', 'proceeds': r['proceeds_RUB'], 'source': sales_path}
             for r in sales['entries']]
    summary = {'source_commit': commit, 'blocks': blocks, 'main_events': len(events),
        'main_movements': len(movements), 'excluded_movement_flags': excluded,
        'structural_issues': issues, 'action_counts': dict(sorted(actions.items())),
        'bybit_rows': len(bybit), 'bybit_types': dict(sorted(Counter(r['Тип'] for r in bybit).items())),
        'bybit_fiat_rows': len(fiat), 'bybit_fiat_currencies': sorted({r['currency'] for r in fiat}),
        'bybit_fiat_rub_total': str(sum((Decimal(r['amount']) for r in fiat), Decimal(0))),
        'trade_timestamp_groups': len(trade_groups),
        'trade_simple_pair_candidates': sum(g['simple_pair_candidate'] for g in trade_groups),
        'trade_net_pair_candidates': sum(g['net_pair_candidate'] for g in trade_groups),
        'trade_rows_without_details': sum(not r['Детали'].strip() for r in bybit if r['Тип'] == 'TRADE'),
        'friend_sales': len(sales), 'friend_proceeds_rub': str(sum((Decimal(r['proceeds']) for r in sales), Decimal(0))),
        'posting_status': 'not_mapped_not_posted', 'inputs': inputs}
    return {'summary.json': summary, 'main-events.json': events, 'main-movements.json': movements,
            'bybit-rows.json': bybit, 'bybit-fiat.json': fiat, 'bybit-trade-groups.json': trade_groups,
            'friend-sales.json': sales}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-ref', default='7b2663b')
    parser.add_argument('--bybit-csv', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if not out.is_relative_to((ROOT / 'outputs').resolve()):
        parser.error('Personal output must be under the ignored workspace outputs/ directory')
    if out.exists():
        parser.error('Use a new output directory to preserve previous inventories')
    data = build(args.source_ref, args.bybit_csv)
    out.mkdir(parents=True)
    for name, value in data.items():
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in data['summary.json'].items() if k != 'inputs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
