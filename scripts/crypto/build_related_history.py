"""Prepare evidence and conservative posting intents; never post or import old basis."""
import argparse
from collections import Counter, defaultdict
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path

from build_history_inventory import BLOCKS, ROOT, git


def build(inventory, local_data):
    summary = json.loads((inventory / 'summary.json').read_text())
    commit = summary['source_commit']
    manifest = []

    def read(path):
        raw = git('show', commit + ':' + path)
        manifest.append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw, parse_float=str)

    paths = set(git('ls-tree', '-r', '--name-only', commit,
                    'crypto-task/chronological-rebuild').decode().splitlines())
    evidence = []
    names = {'owner-decisions.json', 'owner-acceptance.json', 'owner-DOGS-exchange.json',
             'owner-NOT-exchange.json', 'owner-telegram-clarification.json',
             'owner-external-expenses.json', 'telegram-return-evidence.json',
             'external-wallet-events.json', 'bybit-wallet-links.json', 'server-purchases.json'}
    for block, version in BLOCKS:
        prefix = f'crypto-task/chronological-rebuild/blocks/{block}/accepted/{version}/'
        for path in sorted(paths):
            if path.startswith(prefix) and path[len(prefix):] in names:
                evidence.append({'source': path, 'data': read(path),
                                 'status': 'evidence_only_legacy_interpretations_not_accounting_rules'})
    base = 'crypto-task/chronological-rebuild/amendments/'
    for relative in ['2026-09-19-final-owner-clarifications/owner-decisions.json',
                     '2026-09-19-server-purchases-700/owner-decisions.json']:
        path = base + relative
        evidence.append({'source': path, 'data': read(path), 'status': 'owner_evidence_latest_amendment'})
    payments_path = base + '2026-09-19-server-purchases-700/server-payments.json'
    payments = read(payments_path)['payments']
    server_links = defaultdict(list)
    for item in evidence:
        if item['source'].endswith('/server-purchases.json'):
            for row in item['data']:
                key = (row['server_date'], Decimal(row['quantity_TON']), Decimal(row['fiat_paid_RUB']))
                server_links[key].append({'source': item['source'], **row})
    server = []
    seen = set()
    for i, row in enumerate(payments):
        key = (row['date'], Decimal(str(row['ton'])), Decimal(str(row['rub'])))
        if key in seen:
            raise ValueError('Duplicate server payment requires explicit resolution')
        seen.add(key)
        server.append({'source': payments_path, 'source_index': i, 'date': key[0],
                       'asset': 'TON', 'quantity': str(key[1]), 'currency': 'RUB',
                       'amount': str(key[2]), 'intent': 'buy_fiat',
                       'links': server_links.get(key, []), 'posting_status': 'not_posted',
                       'remaining': ['resolve_account_and_cash_origin', 'verify_chain_receipt_and_order']})
    if set(server_links) - seen:
        raise ValueError('Linked server purchase missing from payment register')

    path = local_data / 'telegram_wallet_operations.csv'
    raw = path.read_bytes()
    manifest.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
    telegram = [{**r, 'source_line': i, 'posting_status': 'needs_document_context'}
                for i, r in enumerate(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';'), 2)]
    # Incoming alone does not establish purchase, gift or transfer. CSV has no paid amounts.
    rows = json.loads((inventory / 'bybit-rows.json').read_text())
    intents, transfers = [], defaultdict(list)
    earn = {'Easy Earn | Flexible Interest Distribution': 'reward',
            'Easy Earn | Flexible (Auto-Earn)': 'earn_placement',
            'Easy Earn card redemption': 'earn_redemption',
            'Easy Earn | Flexible Redemption': 'earn_redemption'}
    for row in rows:
        kind, description = row['Тип'], row['Описание']
        qty = Decimal(row['Изменение'].replace(',', '.'))
        intent = 'unresolved'
        if kind == 'Fiat' and description == 'P2P Purchase':
            intent = 'buy_fiat'
        elif kind == 'Earn':
            intent = earn.get(description, 'unresolved')
        elif kind in {'Airdrop', 'AIRDROP'}:
            intent = 'reward'
        elif kind == 'TRADE':
            intent = 'swap_leg'
        elif kind == 'Bybit Card':
            intent = {'Purchase': 'card_purchase', 'Sale': 'card_conversion_leg',
                      'Coin Purchase': 'card_conversion_leg'}.get(description, 'unresolved')
        elif kind in {'Transfer in', 'Transfer out', 'TRANSFER_IN', 'TRANSFER_OUT'}:
            intent = 'own_transfer_leg'
            transfers[(row['Дата'], row['Время'], row['Актив'], abs(qty))].append(row)
        elif kind in {'Deposit', 'Withdraw'}:
            intent = 'wallet_link_required'
        elif kind == 'Bybit Pay':
            intent = 'owner_loan_decision_required'
        intents.append({'source_line': row['_source_line'], 'intent': intent,
                        'quantity': str(qty), 'asset': row['Актив'],
                        'posting_status': 'candidate_not_posted'})
    pairs, ambiguous = [], []
    for key, group in sorted(transfers.items()):
        amounts = [Decimal(r['Изменение'].replace(',', '.')) for r in group]
        valid = (len(group) == 2 and sum(amounts) == 0 and all(amounts)
                 and {r['Счёт'] for r in group} == {'Funding', 'Unified'}
                 and all((a > 0) == (r['Тип'] in {'Transfer in', 'TRANSFER_IN'})
                         for r, a in zip(group, amounts, strict=True)))
        record = {'date': key[0], 'time_as_in_source': key[1], 'asset': key[2],
                  'quantity': str(key[3]), 'source_lines': [r['_source_line'] for r in group]}
        (pairs if valid else ambiguous).append(record)
    assert len(intents) == len(rows) == len({r['source_line'] for r in intents})
    result = {'source_commit': commit, 'bybit_rows_classified': len(intents),
              'intent_counts': dict(Counter(r['intent'] for r in intents)),
              'balanced_internal_pairs': len(pairs), 'ambiguous_internal_groups': len(ambiguous),
              'server_purchases': len(server), 'server_rub': str(sum(Decimal(r['amount']) for r in server)),
              'server_purchases_with_accepted_links': sum(bool(r['links']) for r in server),
              'telegram_rows': len(telegram), 'evidence_documents': len(evidence),
              'status': 'posting_intents_only_not_api_commands', 'inputs': manifest,
              'parent_inventory_sha256': hashlib.sha256((inventory / 'summary.json').read_bytes()).hexdigest()}
    return {'summary.json': result, 'bybit-intents.json': intents, 'internal-transfer-pairs.json': pairs,
            'ambiguous-transfers.json': ambiguous, 'server-purchases.json': server,
            'telegram-rows.json': telegram, 'accepted-evidence.json': evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--local-data', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if not out.is_relative_to((ROOT / 'outputs').resolve()) or out.exists():
        parser.error('Use a new directory under ignored outputs/')
    data = build(args.inventory, args.local_data)
    out.mkdir(parents=True)
    for name, value in data.items():
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in data['summary.json'].items() if k != 'inputs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
