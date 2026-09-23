"""Version a replay plan using archived historical reference quotes, never live prices."""
import argparse
from copy import deepcopy
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

USDT = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe'
CBR = 'https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/06/2024&date_req2=31/07/2024&VAL_NM_RQ=R01235'
RENAME = 'https://announcements.bybit.com/en/article/bybit-toncoin-ton-gram-gram--blt617f4bf48950ab77/'


def build(plan, sources):
    result = deepcopy(plan)
    raw = (sources / 'cbr-usd.xml').read_bytes()
    root = ET.fromstring(raw)
    if root.tag != 'ValCurs' or root.get('ID') != 'R01235':
        raise ValueError('Expected CBR USD history')
    rates = {}
    for record in root:
        day = datetime.strptime(record.attrib['Date'], '%d.%m.%Y').date()
        rate = Decimal(record.findtext('Value').replace(',', '.')) / Decimal(record.findtext('Nominal'))
        if day in rates or not rate.is_finite() or rate <= 0:
            raise ValueError('Invalid CBR rate')
        rates[day] = rate
    inputs = [{'path': str(sources / 'cbr-usd.xml'), 'sha256': hashlib.sha256(raw).hexdigest(), 'url': CBR}]
    valuations = []
    for row in result['rows']:
        for command in row['commands']:
            p = command['payload']
            if command['kind'] != 'swap' or p.get('value_in_base') is not None:
                continue
            when = datetime.fromisoformat(row['occurred_at'])
            day = when.astimezone(ZoneInfo('Europe/Moscow')).date()
            eligible = [d for d in rates if d <= day]
            if not eligible or (day - max(eligible)).days > 7:
                raise ValueError('Missing effective CBR rate')
            effective = max(eligible)
            source_asset = p['position_id']['resource_ref'].split(':ton:', 1)[1]
            target_asset = p['to_crypto_asset_id']['resource_ref'].split(':ton:', 1)[1]
            evidence = dict(date_msk=str(day), cbr_effective_date=str(effective), usd_rub=str(rates[effective]),
                            quality='estimated', stablecoin_assumption='1 USDT = 1 USD reference; not executed RUB trade', cbr_url=CBR)
            if source_asset == USDT:
                usdt = Decimal(p['from_amount'])
                evidence.update(quote_method='executed USDT quantity at reference USD/RUB', usdt=str(usdt))
            else:
                if source_asset == 'native TON':
                    quantity = Decimal(p['from_amount'])
                elif target_asset == 'native TON':
                    quantity = Decimal(p['to_amount'])
                else:
                    raise ValueError('No supported valuation leg')
                minute = int(when.timestamp()) // 60 * 60000
                path = sources / f'gram-{minute}.json'
                raw = path.read_bytes()
                quote = json.loads(raw)
                candles = quote.get('result', {}).get('list', [])
                if quote.get('retCode') != 0 or quote['result'].get('symbol') != 'GRAMUSDT' or len(candles) != 1 or int(candles[0][0]) != minute:
                    raise ValueError('Missing exact historical minute quote')
                opening, high, low, closing = map(Decimal, candles[0][1:5])
                if not all(x.is_finite() and x > 0 for x in (opening, high, low, closing)) or not low <= opening <= high or not low <= closing <= high:
                    raise ValueError('Invalid historical OHLC')
                url = f'https://api.bybit.com/v5/market/kline?category=spot&symbol=GRAMUSDT&interval=1&start={minute}&end={minute+59999}&limit=1'
                inputs.append(dict(path=str(path), sha256=hashlib.sha256(raw).hexdigest(), url=url))
                usdt = quantity * opening
                evidence.update(quote_method='TON quantity at minute opening spot reference', ton=str(quantity),
                                ton_usdt=str(opening), minute_utc=minute, quote_url=url, symbol_identity_source=RENAME,
                                limitation='minute opening reference, not exact DEX execution price')
            value = (usdt * rates[effective]).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
            p.update(value_in_base=str(value), valuation_quality='estimated', valuation_source=json.dumps(evidence, ensure_ascii=False, sort_keys=True))
            valuations.append(dict(source_id=row['source_id'], event_no=row.get('event_no'), value_RUB=str(value), **evidence))
            row['evidence'].setdefault('reference_valuations', []).append(evidence)
    lending_valuations = []
    for row in result['rows']:
        for command in row['commands']:
            p = command['payload']
            if command['kind'] == 'receive_unknown':
                if row.get('event_no') != 15 or p['quantity'] != '0.0000018':
                    raise ValueError('Owner zero-cost convention applies only to the identified microreceipt')
                p.update(basis_assumption='owner_zero', comment='Происхождение неизвестно; нулевая стоимость принята владельцем 23.09.2026 как допущение')
                row['evidence']['owner_basis_assumption'] = '2026-09-23: zero cost accepted; origin remains unknown'
            if command['kind'] not in ('borrow', 'repay', 'accrue'):
                continue
            quantity_key = {'borrow': 'debt_qty', 'repay': 'repay_qty', 'accrue': 'interest_qty'}[command['kind']]
            quantity = Decimal(p[quantity_key])
            if quantity == 0:
                continue
            day = datetime.fromisoformat(row['occurred_at']).astimezone(ZoneInfo('Europe/Moscow')).date()
            eligible = [d for d in rates if d <= day]
            if not eligible or (day-max(eligible)).days > 7:
                raise ValueError('Missing effective lending CBR rate')
            effective = max(eligible)
            value = (quantity*rates[effective]).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
            evidence = dict(date_msk=str(day), cbr_effective_date=str(effective), usd_rub=str(rates[effective]),
                            usdt=str(quantity), cbr_url=CBR, quality='estimated', stablecoin_assumption='1 USDT = 1 USD reference')
            value_key = 'interest_value_in_base' if command['kind']=='accrue' else 'value_in_base'
            p.update({value_key: str(value), 'valuation_quality': 'estimated', 'valuation_source': json.dumps(evidence, sort_keys=True)})
            if command['kind']=='borrow':
                p['comment']='EVAA: 200 USDT; расчётная историческая оценка USD/RUB, не собственное пополнение'
            row['evidence'].setdefault('lending_reference_valuations', []).append(evidence)
            lending_valuations.append(dict(kind=command['kind'], value_RUB=str(value), **evidence))
    result['lending_reference_valuations'] = lending_valuations
    if len(valuations) != 13:
        raise ValueError('Expected exactly thirteen unresolved first-hundred swaps')
    result['inputs'].extend(inputs)
    result['inputs'].append(dict(path=__file__, sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()))
    result['reference_valuations'] = valuations
    result['summary']['reference_valued_swaps'] = len(valuations)
    result['limitations'] = [x for x in result['limitations'] if x != 'Missing historical swap/loan valuations stay unknown']
    result['limitations'].append('Loan/interest reference estimates; event15 zero basis explicitly accepted by owner; Telegram rounding remains conditional')
    result['limitations'].append('All 13 swap valuations are reference estimates; USDT/USD parity is an explicit assumption')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = build(json.loads(args.plan.read_text()), args.sources)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['summary'], ensure_ascii=False))
