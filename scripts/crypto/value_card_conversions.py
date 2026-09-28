"""Link card authorizations and value actual USD proceeds using saved CBR history."""
import argparse
from collections import defaultdict
import csv
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from build_history_inventory import ROOT

CBR_URL = 'https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/12/2024&date_req2=07/09/2026&VAL_NM_RQ=R01235'


def build(plan, exports, xml_path):
    inputs = []

    def source(path):
        raw = path.read_bytes()
        inputs.append({'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()})
        return raw

    cards = json.loads(source(plan / 'pending-card-allocations.json'))
    originals = {}
    for path in sorted(exports.rglob('*bybitCardTransactionHistory*.csv')):
        stream = io.StringIO(source(path).decode('utf-8-sig'))
        next(stream)
        for line, row in enumerate(csv.DictReader(stream), 3):
            if row['Status'] != 'SUCCESS' or row['Type'] not in {'FREEZE', 'DEDUCT'}:
                continue
            key = (row['Uid'], row['Transaction ID'])
            item = originals.setdefault(key, {'raw': row, 'sources': []})
            if item['raw'] != row:
                raise ValueError('Conflicting original card transaction')
            item['sources'].append({'path': str(path.resolve()), 'line': line})
    tree = ET.fromstring(source(xml_path))
    if tree.tag != 'ValCurs' or tree.attrib.get('ID') != 'R01235':
        raise ValueError('Expected CBR USD series')
    rates = {}
    for row in tree:
        day = datetime.strptime(row.attrib['Date'], '%d.%m.%Y').date()
        rate = Decimal(row.findtext('Value').replace(',', '.')) / Decimal(row.findtext('Nominal'))
        if not rate.is_finite() or rate <= 0 or day in rates:
            raise ValueError('Invalid or duplicate CBR rate')
        rates[day] = rate

    def signature(row):
        return (row['Uid'], row['Last 4 Digits'], row['Currency'],
                Decimal(row['Transaction Amount']), row['Payment Currency'], Decimal(row['Payment Amount']))

    authorizations = defaultdict(list)
    completed = defaultdict(list)
    for item in originals.values():
        target = authorizations if item['raw']['Type'] == 'FREEZE' else completed
        target[signature(item['raw'])].append(item)
    linked, used_auth, used_settled = [], set(), set()
    for card in cards:
        amount = Decimal(card['pending_manual_amount'])
        matches = [x for xs in authorizations.values() for x in xs
                   if x['raw']['Transaction Date & Time'][:16] == card['date'] + ' ' + card['time_as_in_source']
                   and x['raw']['Currency'] == card['currency']
                   and Decimal(x['raw']['Transaction Amount']) == amount]
        if len(matches) != 1:
            raise ValueError('Card group has no unique original authorization')
        auth = matches[0]
        ar = auth['raw']
        start = datetime.fromisoformat(ar['Transaction Date & Time'])
        sig = signature(ar)
        later = [datetime.fromisoformat(x['raw']['Transaction Date & Time']) for x in authorizations[sig]
                 if datetime.fromisoformat(x['raw']['Transaction Date & Time']) > start]
        end = min(later) if later else datetime.max
        candidates = [x for x in completed[sig]
                      if start <= datetime.fromisoformat(x['raw']['Transaction Date & Time']) < end
                      and (datetime.fromisoformat(x['raw']['Transaction Date & Time']) - start).days <= 7]
        if len(candidates) != 1:
            raise ValueError(f'Card settlement is ambiguous for {card["date"]}: {len(candidates)} matches; do not choose nearest silently')
        settlement = candidates[0]
        sr = settlement['raw']
        merchant_a = re.sub(r'[^A-Z0-9]', '', ar['Merchant Name'].upper())
        merchant_s = re.sub(r'[^A-Z0-9]', '', sr['Merchant Name'].upper())
        if not merchant_a or not merchant_s or not (merchant_a in merchant_s or merchant_s in merchant_a):
            raise ValueError(f'Card merchant mismatch on {card["date"]}; requires explicit review')
        aid, sid = (ar['Uid'], ar['Transaction ID']), (sr['Uid'], sr['Transaction ID'])
        if aid in used_auth or sid in used_settled:
            raise ValueError('Card original reused')
        used_auth.add(aid)
        used_settled.add(sid)
        day = date.fromisoformat(card['date'])
        available = [d for d in rates if d <= day]
        if not available or (day - max(available)).days > 7:
            raise ValueError('Missing historical USD/RUB rate')
        effective = max(available)
        value = (amount * rates[effective]).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        fee = Decimal(sr['Total Fee'])
        fee_check = None
        if sr['Payment Currency'] == sr['Currency']:
            fee_check = amount == Decimal(sr['Payment Amount']) + fee
            if not fee_check:
                raise ValueError('Card total/fee arithmetic differs from payment amount')
        linked.append({**card, 'authorization': auth, 'settlement': settlement,
                       'link_method': 'exact_authorization_minute_amount_then_unique_same_card_merchant_amount_settlement_before_next_equal_authorization_within_7_days',
                       'settlement_link_quality': 'inferred_unique_composite_not_shared_transaction_id',
                       'historical_value_in_base': str(value), 'base_currency': 'RUB',
                       'valuation_source': CBR_URL, 'valuation_method': 'USD proceeds at official CBR rate on conversion date',
                       'valuation_date': card['date'], 'rate_effective_date': effective.isoformat(),
                       'usd_rub_rate': str(rates[effective]), 'valuation_quality': 'official_reference_rate_not_executed_rub_trade',
                       'reported_card_fee': str(fee), 'fee_additional_posting': False,
                       'same_currency_fee_included_verified': fee_check,
                       'conversion_fee_split': 'unknown_do_not_add_to_observed_crypto_debit',
                       'status': 'valued_not_posted',
                       'required_before_posting': ['resolve_account_and_crypto_asset_identity',
                                                   'verify_fee_split_or_retain_explicit_unsplit_conversion_cost',
                                                   'resolve_timestamp_timezone_and_global_order']})
    if len(used_settled) != sum(len(v) for v in completed.values()):
        raise ValueError('Completed card settlement not covered')
    totals = defaultdict(Decimal)
    for c in linked:
        for asset, qty in c['crypto_debits'].items():
            totals[asset] += Decimal(qty)
    summary = {'status': 'valued_not_posted', 'card_groups': len(linked),
               'original_authorizations_linked': len(used_auth), 'original_settlements_linked': len(used_settled),
               'usd_total': str(sum(Decimal(c['pending_manual_amount']) for c in linked)),
               'historical_rub_total': str(sum(Decimal(c['historical_value_in_base']) for c in linked)),
               'reported_card_fees_not_added_again': str(sum(Decimal(c['reported_card_fee']) for c in linked)),
               'same_currency_fee_checks': sum(c['same_currency_fee_included_verified'] is True for c in linked),
               'observed_crypto_debits': {k: str(v) for k, v in totals.items()},
               'cbr_records': len(rates), 'cbr_first_date': min(rates).isoformat(),
               'cbr_last_date': max(rates).isoformat(), 'inputs': inputs}
    return {'summary.json': summary, 'valued-card-conversions.json': linked}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--bybit-exports', type=Path, required=True)
    parser.add_argument('--cbr-xml', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if out.exists() or not out.is_relative_to((ROOT / 'outputs').resolve()):
        parser.error('Use a new output directory under ignored outputs/')
    result = build(args.plan, args.bybit_exports, args.cbr_xml)
    out.mkdir(parents=True)
    for name, value in result.items():
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result['summary.json'].items() if k != 'inputs'}, indent=2))


if __name__ == '__main__':
    main()
