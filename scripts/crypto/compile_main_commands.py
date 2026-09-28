"""Compile conservative main-wallet command templates, preserving unresolved legs.

Only source-verified cash trades, own transfers, Stars, swaps and two accepted
JETTON rewards are recognized. No inferred income or blanket gift expenses.
Resource references require runtime binding; this script never posts anything.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from build_history_inventory import ROOT, git, quantity


def ref(kind, *parts):
    return {'resource_ref': ':'.join((kind, *parts))}


def bind_commands(commands, bindings):
    """Resolve explicit resource IDs; never manufacture missing positions/accounts."""
    def resolve(value):
        if isinstance(value, dict):
            if set(value) == {'resource_ref'}:
                key = value['resource_ref']
                result = bindings.get(key)
                if type(result) is not int or result <= 0:
                    raise ValueError('Missing or invalid resource binding: ' + key)
                return result
            return {k: resolve(v) for k, v in value.items()}
        if isinstance(value, list):
            return [resolve(v) for v in value]
        return value
    return resolve(commands)


def bind_plan_commands(plan, bindings):
    if plan['blockers'] or plan['status'] != 'quantity_reconciled_requires_bindings_and_global_replay':
        raise ValueError('Cannot bind a blocked or partial event')
    return bind_commands(plan['commands'], bindings)


def compile_events(events, movements, journal, own, rewards):
    grouped = defaultdict(list)
    for m in movements:
        grouped[m['event_id']].append(m)
    main_journal = {r['journal_key'][5:]: r for r in journal if r['journal_key'].startswith('main:')}
    results = []
    for event in events:
        raw = event['raw']
        main = raw['account']['address']
        observed = defaultdict(int)
        precision = {}
        for m in grouped[event['event_id']]:
            if m['excluded_from_financial_perimeter']:
                continue
            master = m['master']
            if master in precision and precision[master] != m['decimals']:
                raise ValueError('Conflicting asset precision')
            precision[master] = m['decimals']
            observed[master] += m['delta_atomic']
        commands, reasons, evidence = [], [], []
        explained = defaultdict(int)
        cash = main_journal[event['event_id']].get('cash_trade')
        cash_used = False

        def add(kind, payload, commands=commands):
            commands.append({'kind': kind, 'payload': payload})

        def asset(master):
            return ref('asset', 'ton', master)

        def pos(wallet, master):
            return ref('position', wallet, 'ton', master)

        def amount(atomic, master, precision=precision):
            return quantity(int(atomic), precision.get(master, 9))

        for index, action in enumerate(raw['actions']):
            typ = action['type']
            if action['status'] != 'ok':
                reasons.append(f'action:{index}:failed_action_requires_fee_review')
                continue
            a = action.get(typ, {})
            if typ in ('TonTransfer', 'JettonTransfer'):
                sender = (a.get('sender') or {}).get('address')
                recipient = (a.get('recipient') or {}).get('address')
                if main not in (sender, recipient) or sender == recipient:
                    reasons.append(f'action:{index}:not_a_direct_main_transfer')
                    continue
                master = 'native TON' if typ == 'TonTransfer' else a['jetton']['address']
                decimals = 9 if typ == 'TonTransfer' else a['jetton']['decimals']
                if master in precision and precision[master] != decimals:
                    raise ValueError('Action and ledger precision disagree')
                precision[master] = decimals
                qty = int(a['amount'])
                if qty <= 0:
                    reasons.append(f'action:{index}:nonpositive_transfer')
                    continue
                incoming = recipient == main
                counterparty = sender if incoming else recipient
                symbol = 'TON' if typ == 'TonTransfer' else a['jetton']['symbol']
                mapped = False
                if (cash and not cash_used and symbol == cash['asset']
                        and incoming == (cash['direction'] == 'buy_fiat')
                        and Decimal(amount(qty, master)) == Decimal(cash['quantity'])):
                    payload = dict(investment_account_id=ref('account', 'main'), bank_account_id=ref('account', 'primary_cash'),
                                   crypto_asset_id=asset(master), quantity=amount(qty, master),
                                   fiat_currency_code=cash['currency'], fiat_amount=cash['fiat_amount'])
                    if incoming:
                        payload.update(purchase_quality=cash['basis_quality'], purchase_source=json.dumps(cash['purchase_source'], ensure_ascii=False, sort_keys=True))
                    add(cash['direction'], payload)
                    cash_used, mapped = True, True
                    evidence.append({'rule': 'linked_cash_trade', 'action_index': index})
                elif counterparty in own:
                    wallet = own[counterparty]['wallet']
                    add('transfer', dict(position_id=pos(wallet if incoming else 'main', master),
                        target_investment_account_id=ref('account', 'main' if incoming else wallet), amount=amount(qty, master)))
                    mapped = True
                    evidence.append({'rule': 'accepted_own_wallet', 'action_index': index, **own[counterparty]})
                elif (not incoming and typ == 'TonTransfer'
                      and counterparty == '0:852443f8599fe6a5da34fe43049ac4e0beb3071bb2bfb56635ea9421287c283a'
                      and 'Telegram Stars' in a.get('comment', '')):
                    add('expense', dict(source_position_id=pos('main', master), quantity=amount(qty, master), comment='Telegram Stars'))
                    mapped = True
                    evidence.append({'rule': 'fragment_stars_address_and_comment', 'action_index': index})
                elif (incoming and event['event_no'] in rewards and symbol == 'JETTON'
                      and master == '0:105e5589bc66db15f13c177a12f2cf3b94881da2f4b8e7922c58569176625eb5'):
                    if Decimal(amount(qty, master)) != Decimal(rewards[event['event_no']]['quantity']):
                        raise ValueError('Owner reward quantity mismatch')
                    add('reward', dict(investment_account_id=ref('account', 'main'), crypto_asset_id=asset(master),
                                       quantity=amount(qty, master), comment='Probable reward, owner recollection'))
                    mapped = True
                    evidence.append({'rule': 'owner_probable_reward', **rewards[event['event_no']]})
                if mapped:
                    explained[master] += qty if incoming else -qty
                else:
                    reasons.append(f'action:{index}:transfer_purpose_or_external_account_not_mapped')
            elif typ == 'JettonSwap' and (a.get('user_wallet') or {}).get('address') == main:
                def swap_leg(side, a=a):
                    if a.get('ton_' + side):
                        return 'native TON', int(a['ton_' + side]), 9
                    token = a.get('jetton_master_' + side)
                    value = a.get('amount_' + side)
                    if token and value:
                        return token['address'], int(value), token['decimals']
                    return None
                left, right = swap_leg('in'), swap_leg('out')
                if not left or not right or left[1] <= 0 or right[1] <= 0:
                    reasons.append(f'action:{index}:swap_missing_principal')
                    continue
                for master, _, decimals in (left, right):
                    if master in precision and precision[master] != decimals:
                        raise ValueError('Swap and ledger precision disagree')
                    precision[master] = decimals
                add('swap', dict(position_id=pos('main', left[0]), from_amount=amount(left[1], left[0]),
                    to_crypto_asset_id=asset(right[0]), to_amount=amount(right[1], right[0]),
                    target_investment_account_id=ref('account', 'main'), value_in_base=None,
                    valuation_source='historical RUB valuation unavailable; do not carry legacy basis'))
                explained[left[0]] -= left[1]
                explained[right[0]] += right[1]
                evidence.append({'rule': 'successful_chain_swap', 'action_index': index, 'valuation_quality': 'unknown'})
            else:
                reasons.append(f'action:{index}:unsupported:{typ}')
        residual = {master: observed[master] - explained[master] for master in set(observed) | set(explained)
                    if observed[master] != explained[master]}
        # A net debit is only treated as a fee if all economic actions are mapped.
        if not reasons and set(residual) == {'native TON'} and residual['native TON'] < 0:
            add('fee', dict(source_position_id=pos('main', 'native TON'),
                           quantity=amount(-residual['native TON'], 'native TON'), comment='Net main TON cost after mapped principals'))
            evidence.append({'rule': 'net_native_cost_after_complete_principal_mapping', 'atomic': -residual['native TON']})
            residual = {}
        if cash and not cash_used:
            reasons.append('linked_cash_principal_not_consumed')
        if residual:
            reasons.append('unexplained_quantity_residual')
        if not commands:
            reasons.append('no_commands')
        # Partial templates are kept for diagnosis but MUST NOT be posted.
        results.append({'event_no': event['event_no'], 'event_id': event['event_id'],
            'occurred_at': datetime.fromtimestamp(event['timestamp'], ZoneInfo('UTC')).isoformat(),
            'accounting_date': datetime.fromtimestamp(event['timestamp'], ZoneInfo('Europe/Moscow')).date().isoformat(),
            'order_in_timestamp': event['lt'], 'commands': commands,
            'status': 'quantity_reconciled_requires_bindings_and_global_replay' if not reasons else 'blocked_do_not_post_partial_commands',
            'blockers': reasons, 'unexplained_atomic': residual, 'evidence': evidence})
    return results


def build(inventory, unified):
    inputs = []

    def read(path):
        raw = path.read_bytes()
        inputs.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    summary = read(inventory / 'summary.json')
    if read(unified / 'summary.json')['source_commit'] != summary['source_commit']:
        raise ValueError('Mixed source versions')
    commit = summary['source_commit']
    events = read(inventory / 'main-events.json')
    movements = read(inventory / 'main-movements.json')
    journal = read(unified / 'journal.json')
    by_no = {e['event_no']: e for e in events}
    own = {}

    def read_git(path):
        raw = git('show', commit + ':' + path)
        inputs.append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest()})
        return json.loads(raw)

    # These accepted links name the wallet and prove the shared on-chain transfer.
    for block in ('0501-0600', '0601-0700', '0701-0800'):
        path = f'crypto-task/chronological-rebuild/blocks/{block}/accepted/v1/own-wallet-links.json'
        external = read_git(path.replace('own-wallet-links.json', 'external-wallet-events.json'))
        for link in read_git(path):
            event = by_no[link['event_no']]['raw']
            other_events = [e for e in external if e['event_id'] == link['external_event_id'] and e.get('wallet') == link['wallet']]
            if not other_events:
                raise ValueError('Own wallet link lacks external event')
            common = {h for a in event['actions'] for h in a.get('base_transactions', [])} & {
                h for e in other_events for a in e['actions'] for h in a.get('base_transactions', [])}
            if not common:
                raise ValueError('Own wallet link lacks shared transaction')
            for action in event['actions']:
                if action['type'] not in ('TonTransfer', 'JettonTransfer') or action['status'] != 'ok' or not common.intersection(action.get('base_transactions', [])):
                    continue
                a = action[action['type']]
                endpoints = {(a.get('sender') or {}).get('address'), (a.get('recipient') or {}).get('address')} - {None, event['account']['address']}
                if len(endpoints) != 1:
                    raise ValueError('Ambiguous own wallet endpoint')
                address = endpoints.pop()
                if address in own and own[address]['wallet'] != link['wallet']:
                    raise ValueError('Conflicting own wallet labels')
                own[address] = {'wallet': link['wallet'], 'source': path, 'event_no': link['event_no'], 'shared_transaction_hashes': sorted(common)}
    reward_path = 'crypto-task/chronological-rebuild/blocks/0601-0700/accepted/v1/owner-decisions.json'
    decision = read_git(reward_path)
    if decision['jetton_rewards_probable'] is not True:
        raise ValueError('Missing accepted reward decision')
    rewards = {606: {'quantity': '52', 'source': reward_path, 'confidence': decision['certainty']},
               664: {'quantity': '61', 'source': reward_path, 'confidence': decision['certainty']}}
    plans = compile_events(events, movements, journal, own, rewards)
    complete = [r for r in plans if not r['blockers']]
    summary = {'source_commit': commit, 'main_events': len(plans), 'quantity_reconciled_events': len(complete),
               'blocked_events': len(plans) - len(complete), 'complete_command_counts': dict(Counter(c['kind'] for r in complete for c in r['commands'])),
               'all_template_command_counts': dict(Counter(c['kind'] for r in plans for c in r['commands'])),
               'status': 'templates_not_posted_no_claim_of_funding_or_global_order', 'inputs': inputs}
    return {'summary.json': summary, 'main-command-plans.json': plans, 'verified-own-addresses.json': own}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('inventory', 'unified', 'output-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    args = p.parse_args()
    out = args.output_dir.resolve()
    if out.exists() or not out.is_relative_to((ROOT / 'outputs').resolve()):
        p.error('Use a new directory under ignored outputs/')
    result = build(args.inventory, args.unified)
    out.mkdir(parents=True)
    for name, data in result.items():
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result['summary.json'].items() if k != 'inputs'}, indent=2))


if __name__ == '__main__':
    main()
