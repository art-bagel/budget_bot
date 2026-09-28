"""Build reviewable cash exchanges and deferred card allocations, without posting."""
import argparse
from collections import Counter, defaultdict
import csv
import io
from decimal import Decimal
import hashlib
import json
from pathlib import Path

from build_history_inventory import ROOT


def positive(value):
    amount = Decimal(str(value).replace(',', '.'))
    if not amount.is_finite() or amount <= 0:
        raise ValueError('Expected positive finite amount')
    return format(amount, 'f')


def build(inventory, related, bybit_exports, telegram=None):
    inputs = []

    def read(folder, name):
        path = folder / name
        raw = path.read_bytes()
        inputs.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    parent = read(inventory, 'summary.json')
    child = read(related, 'summary.json')
    if child['source_commit'] != parent['source_commit'] or child['parent_inventory_sha256'] != inputs[0]['sha256']:
        raise ValueError('Related sources do not match inventory')
    events = read(inventory, 'main-events.json')
    by_no = {r['event_no']: r for r in events}
    by_id = {r['event_id']: r for r in events}
    exchanges = []

    def add(key, direction, date, asset, quantity, amount, evidence, event=None, quality="known"):
        if event and by_no.get(event['event_no']) != event:
            raise ValueError('Invalid event link')
        exchanges.append({'source_key': key, 'direction': direction, 'date_as_in_source': date,
                          'asset': asset, 'quantity': positive(quantity), 'currency': 'RUB',
                          'fiat_amount': positive(amount), 'basis_quality': quality, 'presentation_account': 'primary',
                          'evidence': evidence, 'linked_main_event': None if event is None else {
                              k: event[k] for k in ('event_no', 'event_id', 'timestamp', 'lt')},
                          'status': 'review_plan_not_executable',
                          'required_before_posting': ['resolve_actual_accounts_and_asset_identity',
                                                      'match_existing_bank_operation_or_create_once',
                                                      'resolve_cash_origin_without_fake_own_funding',
                                                      'establish_event_time_and_order']})

    for r in read(inventory, 'bybit-fiat.json'):
        add(f"bybit:line:{r['source_line']}", 'buy_fiat', r['date'], r['asset'], r['quantity'], r['amount'],
            {'file': 'bybit-fiat.json', 'source_line': r['source_line'], 'time_as_in_source': r['time_as_in_source']})
    for r in read(related, 'server-purchases.json'):
        linked = [by_id[x['event_id']] for x in r['links'] if x['event_id'] in by_id]
        if len(linked) > 1:
            raise ValueError('Multiple main receipts for one server purchase')
        add(f"server:payment:{r['source_index']}", 'buy_fiat', r['date'], r['asset'], r['quantity'], r['amount'],
            {'file': 'server-purchases.json', 'source_index': r['source_index'], 'links': r['links']},
            linked[0] if linked else None)
    for r in read(inventory, 'friend-sales.json'):
        add(f"main:event:{r['event_no']}:friend-sale", 'sell_fiat', r['date_msk'], r['asset'],
            r['quantity'], r['proceeds'], {'file': 'friend-sales.json', 'source': r['source']}, by_no[r['event_no']])
    if telegram is not None:
        telegram_summary = read(telegram, 'summary.json')
        if telegram_summary['source_commit'] != parent['source_commit']:
            raise ValueError('Telegram and main source versions differ')
        for r in read(telegram, 'telegram-purchases.json'):
            add(r['source_key'], 'buy_fiat', r['date'], r['asset'], r['quantity'], r['fiat_amount'],
                {'file': 'telegram-purchases.json', 'source_row': r['source_row'],
                 'amount_evidence': r['amount_evidence'], 'time_as_in_source': r['time_as_in_source']},
                quality=r['basis_quality'])
            if r['basis_quality'] == 'estimated':
                exchanges[-1]['required_before_posting'].append('preserve_estimated_cash_and_basis_quality')
    if len({r['source_key'] for r in exchanges}) != len(exchanges):
        raise ValueError('Duplicate cash exchange')
    # Presentation sorting only. No fabricated time or same-day accounting order.
    exchanges.sort(key=lambda r: (r['date_as_in_source'], r['source_key']))

    rows = read(inventory, 'bybit-rows.json')
    groups = defaultdict(list)
    for row in rows:
        if row['Тип'] == 'Bybit Card':
            groups[(row['Дата'], row['Время'], row['Счёт'])].append(row)
    cards, exceptions = [], []
    for key, group in sorted(groups.items()):
        amounts = [(r, Decimal(r['Изменение'].replace(',', '.'))) for r in group]
        debit = [(r, a) for r, a in amounts if r['Актив'] == 'USD' and r['Описание'] == 'Purchase' and a < 0]
        credit = [(r, a) for r, a in amounts if r['Актив'] == 'USD' and r['Описание'] == 'Coin Purchase' and a > 0]
        crypto = [(r, a) for r, a in amounts if r['Актив'] != 'USD' and r['Описание'] in {'Purchase', 'Sale'} and a < 0]
        lines = [r['_source_line'] for r in group]
        if not (len(debit) == len(credit) == 1 and crypto and
                debit[0][1] + credit[0][1] == 0 and len(debit) + len(credit) + len(crypto) == len(group)):
            exceptions.append({'source_lines': lines, 'reason': 'ambiguous_card_group'})
            continue
        funding = defaultdict(Decimal)
        for r, a in crypto:
            funding[r['Актив']] -= a
        cards.append({'source_key': f"bybit:card-usd-debit:{debit[0][0]['_source_line']}",
                      'date': key[0], 'time_as_in_source': key[1], 'currency': 'USD',
                      'pending_manual_amount': str(-debit[0][1]), 'automatic_expense': False,
                      'source_lines': lines,
                      'crypto_debits': {k: str(v) for k, v in sorted(funding.items())},
                      'status': 'candidate_pending_manual_allocation_not_posted',
                      'required_before_posting': ['verify_card_transaction_identity_in_original_export',
                                                  'resolve_historical_rub_valuation_or_unknown',
                                                  'preserve_conversion_without_double_expense',
                                                  'support_nonbase_cash_and_single_manual_settlement']})
    covered = [line for c in cards + exceptions for line in c['source_lines']]
    expected = [r['_source_line'] for r in rows if r['Тип'] == 'Bybit Card']
    if sorted(covered) != sorted(expected) or len(set(covered)) != len(covered):
        raise ValueError('Card coverage mismatch')
    # Original card exports overlap. Deduplicate by exchange transaction ID,
    # not date/amount; authorizations and failed attempts are not expenditures.
    completed = {}
    for path in sorted(bybit_exports.rglob('*bybitCardTransactionHistory*.csv')):
        raw = path.read_bytes()
        inputs.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
        stream = io.StringIO(raw.decode('utf-8-sig'))
        next(stream)  # Export metadata before the real CSV header.
        for line, row in enumerate(csv.DictReader(stream), 3):
            if row['Type'] != 'DEDUCT' or row['Status'] != 'SUCCESS':
                continue
            key = (row['Uid'], row['Transaction ID'])
            if not all(key):
                raise ValueError('Missing card transaction identity')
            if key in completed and completed[key]['raw'] != row:
                raise ValueError('Conflicting overlapping card export')
            item = completed.setdefault(key, {'raw': row, 'sources': []})
            item['sources'].append({'path': str(path.resolve()), 'line': line})
    actual = Counter((r['raw']['Currency'], Decimal(r['raw']['Transaction Amount'])) for r in completed.values())
    planned = Counter((r['currency'], Decimal(r['pending_manual_amount'])) for r in cards)
    if not completed or actual != planned:
        raise ValueError('Card settlement amounts do not reconcile with deferred groups')
    # This is a multiset reconciliation, not proof of each individual pairing.
    summary = {'source_commit': parent['source_commit'], 'status': 'review_plan_not_posted',
               'original_completed_card_transactions': len(completed),
               'card_amount_multiset_matches_original': True,

               'cash_exchange_candidates': len(exchanges),
               'buy_rub_by_quality': {q: str(sum(Decimal(r['fiat_amount']) for r in exchanges
                   if r['direction'] == 'buy_fiat' and r['basis_quality'] == q)) for q in ('known', 'estimated')},
               'buy_rub_total': str(sum(Decimal(r['fiat_amount']) for r in exchanges if r['direction'] == 'buy_fiat')),
               'sale_rub_total': str(sum(Decimal(r['fiat_amount']) for r in exchanges if r['direction'] == 'sell_fiat')),
               'card_source_rows': len(expected), 'card_groups': len(cards), 'card_exceptions': len(exceptions),
               'pending_manual_usd': str(sum(Decimal(r['pending_manual_amount']) for r in cards)),
               'inputs': inputs,
               'limitations': ['not_all_historical_fiat_sources', 'not_total_own_contributions',
                               'no_final_basis_calculated', 'same_minute_grouping_requires_original_identity']}
    return {'summary.json': summary, 'cash-exchanges.json': exchanges,
            'pending-card-allocations.json': cards, 'card-exceptions.json': exceptions,
            'original-card-settlements.json': list(completed.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--related', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--bybit-exports', type=Path, required=True)
    parser.add_argument('--telegram', type=Path)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if out.exists() or not out.is_relative_to((ROOT / 'outputs').resolve()):
        parser.error('Use a new directory under ignored outputs/')
    result = build(args.inventory, args.related, args.bybit_exports, args.telegram)
    out.mkdir(parents=True)
    for name, data in result.items():
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result['summary.json'].items() if k != 'inputs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
