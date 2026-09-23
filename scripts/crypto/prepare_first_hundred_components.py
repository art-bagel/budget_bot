"""Version the first-hundred input for carried costs and component financing.

Only the documented Telegram USDT rounding gaps may be corrected. This is not
an auto-balancing importer: other deficits raise, and each correction is explicit.
"""
import argparse
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path

USDT = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe'


def prepare(source):
    plan = deepcopy(source)
    balance = Decimal(0)
    changes = []
    for row in plan['rows']:
        purchase = row.get('evidence', {}).get('purchase', {})
        if row['source_id'].startswith('telegram:') and purchase.get('asset') == 'USDT':
            for command in row['commands']:
                if command['kind'] in ('bank_buy', 'bank_to_portfolio'):
                    command['payload']['quantity'] = purchase['quantity']
            row['evidence']['quantity_quality'] = 'source_nominal'
            row['evidence'].pop('quantity_scenario_adjustment', None)
            row['evidence']['limitation'] = 'Source rounded quantity; discrepancies posted separately, not exact purchase precision'
            row['evidence'].pop('assumption', None)
        commands = []
        for command in row['commands']:
            kind, payload = command['kind'], command['payload']
            if kind == 'swap':
                for key in ('value_in_base', 'valuation_source', 'valuation_quality'):
                    payload.pop(key, None)
                payload['basis_policy'] = 'carry'
                payload['comment'] = 'Обмен: перенос первоначальных затрат, без рыночной переоценки'
            elif kind == 'close_protocol' and payload.get('allocation_policy') == 'equal':
                payload['allocation_policy'] = 'net_composition'
            elif kind in ('borrow', 'repay', 'accrue'):
                for key in ('valuation_source', 'valuation_quality'):
                    payload.pop(key, None)
                if kind == 'borrow':
                    payload.pop('value_in_base', None)
                    payload['funding_policy'] = 'components'
                    payload['comment'] = 'Заём EVAA: открытые единицы финансирования, не собственное пополнение'
                elif kind == 'repay':
                    payload.pop('value_in_base', None)
                    payload['comment'] = 'Погашение EVAA: стоимость тела в финансируемые позиции, проценты отдельно'
                else:
                    payload['interest_value_in_base'] = None
            if kind == 'bank_to_portfolio' and payload['investment_account_id']['resource_ref'] == 'account:telegram' and payload['crypto_asset_id']['resource_ref'] == f'asset:ton:{USDT}':
                balance += Decimal(payload['quantity'])
            if kind == 'transfer' and payload['position_id']['resource_ref'] == f'position:telegram:ton:{USDT}':
                quantity = Decimal(payload['amount'])
                if quantity > balance:
                    gap = quantity - balance
                    if gap not in (Decimal('0.00258'), Decimal('0.02')):
                        raise ValueError(f'Unapproved rounding gap {gap}: {row["source_id"]}')
                    evidence = {'source_id': row['source_id'], 'nominal_balance': str(balance),
                                'chain_withdrawal': str(quantity), 'difference': str(gap),
                                'policy': 'owner_accepted_rounding_no_new_cost'}
                    row['evidence']['quantity_correction'] = evidence
                    commands.append({'kind': 'quantity_correction', 'payload': {
                        'investment_account_id': {'resource_ref': 'account:telegram'},
                        'crypto_asset_id': {'resource_ref': f'asset:ton:{USDT}'},
                        'quantity': str(gap), 'comment': 'Округление Telegram: отдельная поправка количества без новых затрат'}})
                    balance += gap
                    changes.append(evidence)
                balance -= quantity
            commands.append(command)
        row['commands'] = commands
    if sorted(Decimal(x['difference']) for x in changes) != [Decimal('0.00258'), Decimal('0.02')]:
        raise ValueError(f'Unexpected set of corrections: {changes}')
    plan.update(funding_components=True, diagnostic_only=False,
                accounting_policy='carried_cost_and_financing_components_v1',
                quantity_corrections=changes, expected_telegram_usdt=str(balance))
    plan['limitations'] = [
        'Telegram source quantities are rounded; two evidenced quantity-only adjustments',
        'Net-composition LP allocation is the agreed cost convention, not reconstruction of every internal trade',
        'EVAA residuals are last-observed quantities; boundary index unavailable',
        'Event15 zero cost explicitly accepted, origin still unknown',
        'Unknown-time purchases and final 18 nano-TON fee have explicit ordering placeholders',
        'Internal Bybit presentation and complete market valuation remain separate UI work',
    ]
    plan.pop('reference_valuations', None)
    plan.pop('lending_reference_valuations', None)
    plan.pop('diagnostic_reason', None)
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.plan.read_bytes()
    plan = prepare(json.loads(source))
    plan['policy_source_plan'] = {'path': str(args.plan), 'sha256': hashlib.sha256(source).hexdigest()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'corrections': plan['quantity_corrections'], 'telegram_usdt': plan['expected_telegram_usdt']}, ensure_ascii=False))
