"""Compile a contiguous first-block prefix from locked evidence, never old basis.

The prefix is deliberately gated at event 6. Remaining accepted decisions are
listed for implementation, not counted as loaded. Output stays private.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from build_history_inventory import ROOT, git
from compile_main_commands import ref

PIN = '7b2663b7ea2f1bc4256eb83dffede384f488e8b6'
BASE = 'crypto-task/chronological-rebuild/blocks/0001-0100/accepted/v1/'
TON = 'native TON'
NOT = '0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc'


def build():
    inputs = []

    def read(path, pinned=False):
        raw = git('show', PIN + ':' + path) if pinned else (ROOT / path).read_bytes()
        inputs.append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'commit': PIN if pinned else None})
        return json.loads(raw)

    events = read('outputs/crypto-history-inventory-2026-09-23-v2/main-events.json')[:100]
    movements = read('outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json')[:295]
    reviews = read(BASE + 'review.json', True)
    workbook = read(BASE + 'workbook-data.json', True)
    facts = read(BASE + 'closure-facts.json', True)
    own = read(BASE + 'cost-flow-0031.json', True)['own_NOT_transfers']
    purchases = read('outputs/crypto-telegram-history-2026-09-23-v2/telegram-purchases.json')
    telegram = read('outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json')
    assert facts['initial_NOT']['classification'] == 'owner_confirmed_airdrop'
    assert [e['event_no'] for e in events] == list(range(1, 101))
    assert len(movements) == 295 and len(reviews) == 100
    totals = defaultdict(lambda: defaultdict(Decimal))
    checkpoints = {}
    balances = defaultdict(Decimal)
    assets = {}
    for m in movements:
        totals[m['event_no']][m['master']] += Decimal(m['quantity_delta'])
        balances[m['master']] += Decimal(m['quantity_delta'])
        assets[m['master']] = {'symbol': m['asset'], 'decimals': m['decimals']}
        if m['event_no'] <= 6:
            checkpoints[m['event_no']] = {k: str(v) for k, v in balances.items()}
    rows = []

    def command(kind, **payload):
        return {'kind': kind, 'payload': payload}

    def pos(wallet, master=TON):
        return ref('position', wallet, 'ton', master)

    def transfer(wallet, target, qty, master=TON):
        return command('transfer', position_id=pos(wallet, master), target_investment_account_id=ref('account', target), amount=str(qty))

    def fee(wallet, qty):
        assert Decimal(qty) > 0
        return command('fee', source_position_id=pos(wallet), quantity=str(qty), comment='Сетевые/сервисные затраты, отдельно от себестоимости остатка')

    # Exact source times where present; synthetic ordering ONLY for date-only
    # purchases. Same-day unresolved rows 13/14 are both buys of the same asset.
    for r in purchases:
        if r['source_row'] > 17:
            continue
        when = datetime.fromisoformat(r['date'] + 'T' + (r['time_as_in_source'] or '12:00')).replace(tzinfo=ZoneInfo('Europe/Moscow'))
        rows.append(dict(source_id=r['source_key'], occurred_at=when.astimezone(timezone.utc).isoformat(),
            accounting_date=r['date'], order_in_timestamp=r['source_row'], funding_RUB=r['fiat_amount'],
            evidence={'purchase': r, 'time_quality': 'source_minute' if r['time_as_in_source'] else 'date_only_ordering_placeholder',
                      'funding_boundary': 'Documented RUB paid for crypto, not reconstructed salary/bank income'},
            commands=[command('buy_fiat', investment_account_id=ref('account', 'telegram'), bank_account_id=ref('account', 'primary_cash'),
                crypto_asset_id=ref('asset', 'ton', TON), quantity=r['quantity'], fiat_currency_code='RUB',
                fiat_amount=r['fiat_amount'], purchase_quality=r['basis_quality'], purchase_source=json.dumps(r['amount_evidence'], ensure_ascii=False))]))
    assert len(rows) == 14
    withdrawal = next(r for r in telegram if r['source_row'] == 12)
    assert withdrawal['quantity'] == '4.947'
    rows.append(dict(source_id=withdrawal['source_key'], occurred_at='2024-02-02T10:22:00+00:00', accounting_date='2024-02-02', order_in_timestamp=12,
        evidence={'source': withdrawal, 'classification': 'pre-main external outflow; destination unresolved; not a claimed owned balance'},
        commands=[command('expense', source_position_id=pos('telegram'), quantity=withdrawal['quantity'],
                          comment='Вывод до main: получатель не установлен; внешний отток, назначение неизвестно')]))
    lp_info = None
    for e in events[:6]:
        n = e['event_no']
        net = totals[n]
        commands = []
        evidence = {'accepted_review': reviews[n-1], 'basis_policy': 'docs/crypto-accounting-policy.md', 'old_cost_values_imported': False}
        if n == 1:
            assert net[NOT] == 6572 and len(net) == 1
            commands = [command('reward', investment_account_id=ref('account', 'main'), crypto_asset_id=ref('asset', 'ton', NOT), quantity='6572', comment='Подтверждённый airdrop NOT за игру')]
        elif n == 2:
            assert net[TON] == 10
            source = next(r for r in telegram if r['source_row'] == 16)
            assert source['quantity'] == '10.05'
            evidence.update(telegram_source=source, withdrawal_difference_policy='0.05 TON assumed withdrawal cost, separately expensed; no new purchase')
            commands = [transfer('telegram', 'main', '10'), fee('telegram', '0.05')]
        elif n in (3, 6):
            link = next(r for r in own if r['event_no'] == n)
            assert link['event_id'] == e['event_id'] and -net[NOT] == Decimal(link['quantity_NOT'])
            evidence['own_link'] = link
            commands = [transfer('main', 'telegram', -net[NOT], NOT), fee('main', -net[TON])]
        elif n == 4:
            a = e['raw']['actions']
            principal = Decimal(a[0]['TonTransfer']['amount']) / Decimal(10**9)
            not_qty = Decimal(a[1]['JettonTransfer']['amount']) / Decimal(10**9)
            lp_master = next(k for k in net if k not in (TON, NOT))
            assert principal == Decimal('9.357406226') and net[NOT] == -not_qty
            lp_info = {'master': lp_master, 'quantity': str(net[lp_master]), 'custody': 'main', 'event_id': e['event_id']}
            commands = [command('create_protocol', investment_account_id=ref('account', 'main'), protocol_name='STON.fi',
                position_type='liquidity_pool', asset_symbol='TON', source_position_id=pos('main'),
                quantity=str(principal), crypto_asset_id=ref('asset', 'ton', TON), secondary_source_position_id=pos('main', NOT),
                secondary_quantity=str(not_qty), network_code='ton', metadata={'lp_receipt': lp_info},
                comment='Событие 4: капитал TON и NOT в пуле; LP-токен — подтверждение доли, не дополнительный капитал'),
                fee('main', -net[TON] - principal)]
        elif n == 5:
            assert len(net) == 1 and net[TON] < 0
            commands = [fee('main', -net[TON])]
        rows.append(dict(source_id='main:' + e['event_id'], event_no=n,
            occurred_at=datetime.fromtimestamp(e['timestamp'], timezone.utc).isoformat(),
            accounting_date=datetime.fromtimestamp(e['timestamp'], ZoneInfo('Europe/Moscow')).date().isoformat(),
            order_in_timestamp=int(e['lt']), evidence=evidence, commands=commands,
            expected_main=checkpoints[n], lp_receipt=lp_info))
    rows.sort(key=lambda r: (r['occurred_at'], r['order_in_timestamp']))
    assert len({r['source_id'] for r in rows}) == len(rows)
    status = [{'event_no': e['event_no'], 'event_id': e['event_id'], 'description': workbook['events'][i][2],
               'accepted_explanation': reviews[i]['explanation'],
               'status': 'compiled_contiguous_prefix_requires_api' if i < 6 else 'accepted_analysis_requires_command_mapping',
               'uploaded': False} for i, e in enumerate(events)]
    return {'inputs': inputs, 'assets': assets, 'rows': rows, 'events': status,
            'summary': {'block': '0001-0100', 'total_events': 100, 'total_movements': 295,
                'compiled_contiguous_prefix': 6, 'source_events': len(rows),
                'command_counts': dict(Counter(c['kind'] for r in rows for c in r['commands'])),
                'first_unimplemented_event': 7, 'first_unimplemented_kind': workbook['events'][6][2],
                'loaded': 0, 'verified': 0, 'block_closed': False}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = build()
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['summary'], ensure_ascii=False))
