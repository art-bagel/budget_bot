"""Build a versioned source journal with exactly-once claims; no database writes.

Not an executable API journal: unresolved clocks, asset identities and protocol
commands stay explicit. Legacy monetary basis is deliberately never copied.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path

from build_history_inventory import ROOT, git


def build(inventory, telegram, related, cash, cards):
    inputs = []

    def read(folder, name):
        path = folder / name
        raw = path.read_bytes()
        inputs.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    parent = read(inventory, 'summary.json')
    for folder in (telegram, related, cash):
        if read(folder, 'summary.json')['source_commit'] != parent['source_commit']:
            raise ValueError('Mixed source versions')
    events = read(inventory, 'main-events.json')
    movements = read(inventory, 'main-movements.json')
    bybit = read(inventory, 'bybit-rows.json')
    tg = read(telegram, 'telegram-source-rows.json')
    rows, claims = {}, {}
    expected = ({f"main:{e['event_id']}" for e in events}
                | {f"movement:{m['source_row']}" for m in movements}
                | {f"bybit:line:{r['_source_line']}" for r in bybit}
                | {r['source_key'] for r in tg})
    by_id = {e['event_id']: e for e in events}
    by_no = {e['event_no']: e for e in events}
    by_tg = {r['source_row']: r for r in tg}
    by_line = {r['_source_line']: r for r in bybit}

    def create(key, date, kind, blockers, timestamp=None):
        if key in rows:
            raise ValueError('Duplicate journal identity')
        rows[key] = {'journal_key': key, 'date': date, 'timestamp_utc': timestamp,
                     'kind': kind, 'claims': [], 'evidence': [], 'legs': [],
                     'blockers': blockers, 'posting_status': 'not_executable_not_posted'}
        return rows[key]

    def claim(row, key):
        if key in claims:
            raise ValueError('Duplicate source claim: ' + key)
        claims[key] = row['journal_key']
        row['claims'].append(key)

    main_rows = {}
    for e in events:
        stamp = datetime.fromtimestamp(e['timestamp'], timezone.utc)
        row = create('main:' + e['event_id'], stamp.date().isoformat(), 'chain_event',
                     ['map_economic_commands_and_related_accounts'], stamp.isoformat())
        row['main_event_no'] = e['event_no']
        row['chain_order'] = {'timestamp': e['timestamp'], 'lt': e['lt']}
        row['action_types'] = [a['type'] for a in e['raw']['actions']]
        row['evidence'].append({'file': e['source'], 'event_id': e['event_id']})
        claim(row, row['journal_key'])
        main_rows[e['event_id']] = row
    balances, decimals, checkpoints = {}, {}, []
    original_balances, original_checkpoints = {}, {}
    checkpoint_rows = {max(m['source_row'] for m in movements if m['event_no'] <= n): n
                       for n in list(range(100, 1001, 100)) + [1049]}
    movement_order = []
    interleaved = []
    seen_events, previous_event = set(), None
    for m in movements:
        movement_order.append({k: m[k] for k in ('source_row', 'event_no', 'event_id', 'lt')})
        if m['event_id'] != previous_event and m['event_id'] in seen_events:
            interleaved.append({'source_row': m['source_row'], 'event_no': m['event_no']})
        seen_events.add(m['event_id'])
        previous_event = m['event_id']
        if m['delta_atomic'] is not None:
            if m['master'] in original_balances and original_balances[m['master']] != m['before_atomic']:
                raise ValueError('Broken source movement continuity')
            original_balances[m['master']] = m['after_atomic']
        if m['source_row'] in checkpoint_rows:
            original_checkpoints[checkpoint_rows[m['source_row']]] = dict(original_balances)
    by_event = defaultdict(list)
    for m in movements:
        by_event[m['event_id']].append(m)
    for e in events:
        row = main_rows[e['event_id']]
        for m in by_event[e['event_id']]:
            claim(row, f"movement:{m['source_row']}")
            excluded = m['excluded_from_financial_perimeter']
            row['legs'].append({k: m[k] for k in ('source_row', 'asset', 'master', 'decimals', 'quantity_delta', 'excluded_from_financial_perimeter')})
            if excluded and m['delta_atomic'] is None:
                continue
            if m['before_atomic'] + m['delta_atomic'] != m['after_atomic']:
                raise ValueError('Broken movement arithmetic')
            if m['master'] in decimals and decimals[m['master']] != m['decimals']:
                raise ValueError('Conflicting asset precision')
            balances[m['master']] = balances.get(m['master'], m['before_atomic']) + m['delta_atomic']
            decimals[m['master']] = m['decimals']
        if e['event_no'] % 100 == 0 or e['event_no'] == 1049:
            if balances != original_checkpoints[e['event_no']]:
                raise ValueError('Regrouped event checkpoint differs from accepted source')
            checkpoints.append({'event_no': e['event_no'], 'event_id': e['event_id'],
                                'balances_atomic': dict(balances), 'decimals': dict(decimals)})

    def chain_quantity(event_id, asset, sign):
        return sum((Decimal(m['quantity_delta']) for m in by_event[event_id]
                    if m['asset'] == asset and m['quantity_delta'] is not None
                    and Decimal(m['quantity_delta']) * sign > 0), Decimal(0))

    def action_quantity(event_id, asset, incoming):
        event = by_id[event_id]['raw']
        total = Decimal(0)
        for action in event['actions']:
            if action['status'] != 'ok' or action['type'] not in ('TonTransfer', 'JettonTransfer'):
                continue
            value = action[action['type']]
            symbol = 'TON' if action['type'] == 'TonTransfer' else value['jetton']['symbol']
            precision = 9 if symbol == 'TON' else value['jetton']['decimals']
            endpoint = value.get('recipient' if incoming else 'sender') or {}
            if symbol == asset and endpoint.get('address') == event['account']['address']:
                total += Decimal(str(value['amount'])) / Decimal(10) ** precision
        return total

    links = []
    exchanges = read(cash, 'cash-exchanges.json')
    for c in exchanges:
        link = c['linked_main_event']
        if link:
            event_id = link['event_id']
            if by_no[link['event_no']]['event_id'] != event_id:
                raise ValueError('Cash event identity mismatch')
            if action_quantity(event_id, c['asset'], c['direction'] == 'buy_fiat') != Decimal(c['quantity']):
                raise ValueError('Cash link does not match chain transfer: ' + c['source_key'])
            row = main_rows[event_id]
            links.append({'source_key': c['source_key'], 'event_id': event_id, 'kind': c['direction']})
        else:
            row = create(c['source_key'], c['date_as_in_source'], c['direction'],
                         ['resolve_accounts_assets_cash_origin_and_time_order'])
        claim(row, c['source_key'])
        expected.add(c['source_key'])
        if 'cash_trade' in row:
            raise ValueError('Multiple cash principals mapped to one chain event')
        row['cash_trade'] = {k: c[k] for k in ('direction', 'asset', 'quantity', 'currency', 'fiat_amount', 'basis_quality')}
        row['evidence'].append(c['evidence'])
        if any(x.get('wallet') == 'cold' for x in c['evidence'].get('links', [])):
            row['blockers'].append('load_linked_cold_wallet_event_not_main')
        row['cash_trade']['purchase_source'] = c['evidence'] if c['direction'] == 'buy_fiat' else None
        row['cash_trade']['replaces_linked_chain_principal'] = bool(link)

    for link in read(telegram, 'telegram-main-usdt-links.json'):
        event_id = link['event_id']
        source = by_tg[link['telegram_row']]
        if source['operation'] != 'Вывод' or source['asset'] != 'USDT' or Decimal(source['quantity']) != Decimal(link['document_quantity']):
            raise ValueError('Telegram transfer source mismatch')
        if chain_quantity(event_id, 'USDT', 1) != Decimal(link['chain_received']):
            raise ValueError('Telegram transfer chain mismatch')
        row = main_rows[event_id]
        claim(row, source['source_key'])
        evidence = {**link, 'kind': 'own_transfer', 'direction': 'telegram_to_main',
                    'difference_not_automatically_fee': str(Decimal(link['chain_received']) - Decimal(link['document_quantity']))}
        row['evidence'].append(evidence)
        links.append(evidence)
        row['blockers'].append('resolve_document_precision_without_invented_fee')

    return_path = 'crypto-task/chronological-rebuild/blocks/0101-0200/accepted/v2/telegram-return-evidence.json'
    raw = git('show', parent['source_commit'] + ':' + return_path)
    inputs.append({'path': return_path, 'sha256': hashlib.sha256(raw).hexdigest()})
    for link in json.loads(raw):
        event_id = link['event']
        source = by_tg[link['telegram_row']]
        action = by_id[event_id]['raw']['actions'][link['action_index']]
        if (source['operation'] != 'Пополнение' or source['asset'] != 'TON'
                or Decimal(source['quantity']) != Decimal(link['amount'])
                or action['type'] != 'TonTransfer' or action['status'] != 'ok'
                or action['TonTransfer']['recipient']['address'] != link['recipient']
                or action_quantity(event_id, 'TON', False) != Decimal(link['amount'])):
            raise ValueError('Telegram return evidence mismatch')
        row = main_rows[event_id]
        claim(row, source['source_key'])
        evidence = {'source_key': source['source_key'], 'event_id': event_id,
                    'kind': 'own_transfer', 'direction': 'main_to_telegram', 'quantity': link['amount'], 'source': return_path}
        row['evidence'].append(evidence)
        links.append(evidence)

    swaps = {r['source_key']: r for r in read(telegram, 'telegram-owner-swaps.json')}
    for source in tg:
        if source['source_key'] in claims:
            continue
        row = create(source['source_key'], source['date'], 'telegram_unresolved',
                     ['resolve_telegram_semantics_and_accounts', 'resolve_timestamp_and_order'])
        claim(row, source['source_key'])
        row['evidence'].append(source)
        if source['source_key'] in swaps:
            row['kind'] = 'swap'
            row['swap'] = swaps[source['source_key']]
            row['blockers'] = ['resolve_accounts_assets_and_order', 'historical_rub_value_unknown']
        # “Доход” often means return of an Earn principal; never auto-create reward.

    for c in read(cards, 'valued-card-conversions.json'):
        row = create(c['source_key'], c['date'], 'card_conversion_pending_expense',
                     ['resolve_assets_accounts_and_timestamp_order'])
        for line in c['source_lines']:
            if by_line[line]['Тип'] != 'Bybit Card':
                raise ValueError('Card claim is not a card source')
            claim(row, f'bybit:line:{line}')
        row['card_conversion'] = {k: c[k] for k in ('crypto_debits', 'pending_manual_amount', 'currency', 'historical_value_in_base', 'valuation_source')}
        row['automatic_expense'] = False
    for g in read(inventory, 'bybit-trade-groups.json'):
        row = create('bybit:swap:' + str(min(g['source_lines'])), g['date'], 'swap',
                     ['verify_trade_order_and_fee', 'historical_rub_value_unknown'])
        for line in g['source_lines']:
            if by_line[line]['Тип'] != 'TRADE':
                raise ValueError('Swap claim is not a trade source')
            claim(row, f'bybit:line:{line}')
        row['swap_net_quantities'] = g['net_quantities']
        row['evidence'].append(g)
        row['visible_in_feed'] = False
    for g in read(related, 'internal-transfer-pairs.json'):
        row = create('bybit:internal:' + str(min(g['source_lines'])), g['date'], 'internal_transfer', [])
        net = Decimal(0)
        for line in g['source_lines']:
            source = by_line[line]
            if source['Актив'] != g['asset'] or source['Дата'] != g['date']:
                raise ValueError('Internal pair source mismatch')
            net += Decimal(source['Изменение'].replace(',', '.'))
            claim(row, f'bybit:line:{line}')
        if net != 0:
            raise ValueError('Internal pair does not balance')
        row['evidence'].append(g)
        row['visible_in_feed'] = False
        row['posting_status'] = 'calculation_only_no_portfolio_change'
    intents = {r['source_line']: r['intent'] for r in read(related, 'bybit-intents.json')}
    for source in bybit:
        key = f"bybit:line:{source['_source_line']}"
        if key in claims:
            continue
        row = create(key, source['Дата'], intents[source['_source_line']],
                     ['resolve_source_semantics_accounts_and_timestamp_order'])
        claim(row, key)
        row['evidence'].append(source)
        row['visible_in_feed'] = False
    if set(claims) != expected:
        raise ValueError('Missing or unexpected source coverage')
    decisions = read(related, 'accepted-evidence.json')
    ordered = sorted(rows.values(), key=lambda r: (r['date'], r['timestamp_utc'] or '', r['journal_key']))
    # Display order only: undated-within-day sources must not be posted in this order.
    summary = {'source_commit': parent['source_commit'], 'journal_records': len(rows),
               'source_claims': len(claims), 'main_events': len(events), 'main_movements': len(movements),
               'telegram_rows': len(tg), 'bybit_rows': len(bybit), 'verified_cross_source_links': len(links),
               'kind_counts': dict(Counter(r['kind'] for r in ordered)), 'checkpoints': len(checkpoints), 'interleaved_event_resumptions': len(interleaved),
               'unresolved_records': sum(bool(r['blockers']) for r in ordered),
               'blocker_counts': dict(Counter(b for r in ordered for b in r['blockers'])),
               'status': 'normalized_source_journal_not_executable', 'display_order_is_not_posting_order': True,
               'legacy_basis_imported': False, 'accepted_evidence_documents': len(decisions), 'inputs': inputs}
    return {'summary.json': summary, 'journal.json': ordered, 'source-claims.json': claims,
            'cross-source-links.json': links, 'quantity-checkpoints.json': checkpoints, 'movement-order.json': movement_order,
            'interleaved-events.json': interleaved, 'accepted-decisions.json': decisions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('inventory', 'telegram', 'related', 'cash', 'cards', 'output-dir'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if out.exists() or not out.is_relative_to((ROOT / 'outputs').resolve()):
        parser.error('Use a new directory under ignored outputs/')
    result = build(args.inventory, args.telegram, args.related, args.cash, args.cards)
    out.mkdir(parents=True)
    for name, data in result.items():
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result['summary.json'].items() if k != 'inputs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
