"""Offline verification of the five known EVAA liquidations.

Run from the repository root: python scripts/crypto/verify_evaa_liquidations.py
    --evidence-dir outputs/evaa-liquidation-history --output REPORT.json
The directory must contain trace-{740,741,742,743}.json fetched from the
public URLs in the output manifest. February's trace and accepted records
are read from pinned Git history. No application database is accessed.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

REF = '7b2663b'
PREFIX = 'crypto-task/crypto-reconciliation/work/'
SCALE = 10**12


def git_bytes(path):
    return subprocess.check_output(['git', 'show', f'{REF}:{path}'])


class Bits:
    def __init__(self, bits):
        self.bits = bits
        self.position = 0

    def u(self, size):
        assert 0 <= size <= len(self.bits) - self.position
        value = int(self.bits[self.position:self.position + size] or '0', 2)
        self.position += size
        return value

    def i(self, size):
        value = self.u(size)
        return value - (1 << size) if value >> (size - 1) else value

    def address(self):
        assert self.u(2) == 2 and self.u(1) == 0
        return f'{self.i(8)}:{self.u(256):064x}'


def boc(raw):
    """Read ordinary cells; adapted from the accepted local EVAA BOC reader."""
    data = bytes.fromhex(raw)
    assert data[:4] == bytes.fromhex('b5ee9c72')
    position = 4

    def take(size):
        nonlocal position
        assert position + size <= len(data)
        value = int.from_bytes(data[position:position + size], 'big')
        position += size
        return value

    flags, offset = take(1), take(1)
    size = flags & 7
    count, root_count, absent = take(size), take(size), take(size)
    total = take(offset)
    roots = [take(size) for _ in range(root_count)]
    assert absent == 0 and roots == [0] and 0 < count < 10000
    if flags & 128:
        position += count * offset
    start = position
    cells = []
    for _ in range(count):
        descriptor, length = take(1), take(1)
        assert descriptor & 0xf8 == 0, 'Only ordinary level-zero cells are supported'
        payload = take((length + 1) // 2)
        bits = format(payload, f'0{((length + 1) // 2) * 8}b') if length else ''
        if length % 2:
            assert '1' in bits
            bits = bits[:bits.rfind('1')]
        refs = [take(size) for _ in range(descriptor & 7)]
        assert all(0 <= ref < count for ref in refs)
        cells.append((bits, refs))
    assert position - start == total
    return cells


def dictionary(cells, index, width, prefix=0):
    bits = Bits(cells[index][0])
    if bits.u(1) == 0:
        length = 0
        while bits.u(1):
            length += 1
            assert length <= width
        label = bits.u(length)
    elif bits.u(1) == 0:
        length = bits.u(width.bit_length())
        label = bits.u(length)
    else:
        bit = bits.u(1)
        length = bits.u(width.bit_length())
        label = ((1 << length) - 1) * bit
    assert length <= width
    prefix = (prefix << length) | label
    remaining = width - length
    if remaining == 0:
        yield prefix, bits
    else:
        assert len(cells[index][1]) == 2
        for bit, ref in enumerate(cells[index][1]):
            yield from dictionary(cells, ref, remaining - 1, (prefix << 1) | bit)


def nodes(node):
    yield node
    for child in node.get('children', []):
        yield from nodes(child)


def command(raw):
    cells = boc(raw)
    bits = Bits(cells[0][0])
    version = bits.u(bits.u(4) * 8)
    upgrade = bits.u(1)
    assert bits.u(2) in (0, 3)
    op, query = bits.u(32), bits.u(64)
    return cells, bits, version, upgrade, op, query


def amount(atomic, decimals):
    return format(Decimal(atomic).scaleb(-decimals), 'f')


def verify(event, trace):
    assert trace.get('emulated') is False
    matches = [n for n in nodes(trace) if n['transaction']['hash'] == event['transaction']]
    assert len(matches) == 1
    node = matches[0]
    tx = node['transaction']
    cells, bits, version, upgrade, op, query = command(tx['in_msg']['raw_body'])
    assert op == 0x31 and query == event['query_id']
    assert bits.u(1) == bits.u(1) == 1
    assert bits.position == len(bits.bits)
    rates = {key: (value.u(64), value.u(64))
             for key, value in dictionary(cells, cells[0][1][upgrade + 1], 256)}
    responses = [n for n in node.get('children', [])
                 if n['transaction']['in_msg'].get('op_code') == '0x00000311']
    assert len(responses) == 1
    response = responses[0]['transaction']
    assert response['in_msg']['source']['address'] == tx['account']['address']
    assert response['account']['address'] == tx['in_msg']['source']['address']
    rc = boc(response['in_msg']['raw_body'])
    rb = Bits(rc[0][0])
    assert rb.u(32) == 0x311 and rb.u(64) == query
    owner, liquidator, debt_asset = rb.address(), rb.address(), rb.u(256)
    assert owner == event['owner'] and liquidator == event['liquidator']
    detail = Bits(rc[rc[0][1][0]][0])
    debt_delta, payment, gift, debt_after = detail.i(64), detail.u(64), detail.u(64), detail.i(64)
    collateral_asset = detail.u(256)
    collateral_delta, payout = detail.i(64), detail.u(64)
    minimum, collateral_after = detail.u(64), detail.i(64)
    assert [-debt_delta, payment, gift, debt_after, collateral_delta, payout, collateral_after] == [
        event['debt_principal_reduction'], event['liquidatable_amount_atomic'],
        event['protocol_gift_atomic'], event['debt_principal_after'],
        event['collateral_principal_reduction'], event['collateral_reward_atomic'],
        event['collateral_principal_after']]
    assert payout >= minimum
    assert debt_after + debt_delta == event['debt_principal_before']
    assert collateral_after + collateral_delta == event['collateral_principal_before']
    acknowledgements = []
    for sub in nodes(responses[0]):
        t = sub['transaction']
        if t['account']['address'] != tx['account']['address']:
            continue
        _, ab, _, _, aop, aq = command(t['in_msg']['raw_body'])
        assert aop != 0x311f, 'Liquidation was reverted'
        if aop == 0x311a and aq == query:
            assert ab.u(256) == debt_asset and ab.i(64) == debt_delta
            ab.u(64)
            ab.u(64)
            assert ab.u(256) == collateral_asset and ab.i(64) == collateral_delta
            acknowledgements.append(t)
    assert len(acknowledgements) == 1
    assert all(t['success'] and not t['aborted'] for t in [tx, response, *acknowledgements])
    borrow_rate = rates[debt_asset][1]
    supply_rate = rates[collateral_asset][0]
    debt_before_tokens = -event['debt_principal_before'] * borrow_rate // SCALE
    debt_after_tokens = -debt_after * borrow_rate // SCALE
    collateral_before_tokens = event['collateral_principal_before'] * supply_rate // SCALE
    collateral_after_tokens = collateral_after * supply_rate // SCALE
    # EVAA uses floor for positive supply and ceiling for negative debt.
    assert -((debt_before_tokens - payment) * SCALE // borrow_rate) == debt_after
    assert (collateral_before_tokens - payout) * SCALE // supply_rate == collateral_after
    debt_removed = debt_before_tokens - debt_after_tokens
    collateral_removed = collateral_before_tokens - collateral_after_tokens
    assert 0 <= debt_removed - payment <= 1
    assert 0 <= collateral_removed - payout <= 1
    return dict(event=event.get('event_no', 'February-2025'), transaction=event['transaction'],
                timestamp=tx['utime'], user_code_version=version,
                collateral_asset=event['collateral_asset'], debt_asset=event['debt_asset'],
                borrow_rate=str(borrow_rate), supply_rate=str(supply_rate),
                debt_before=amount(debt_before_tokens, 6), debt_after=amount(debt_after_tokens, 6),
                debt_removed=amount(debt_removed, 6), debt_payment=amount(payment, 6),
                liquidator_protocol_gift=amount(gift, 6),
                debt_rounding=amount(debt_removed - payment, 6),
                collateral_before=amount(collateral_before_tokens, 9),
                collateral_after=amount(collateral_after_tokens, 9),
                collateral_removed=amount(collateral_removed, 9),
                collateral_paid=amount(payout, 9), collateral_rounding=amount(collateral_removed - payout, 9),
                historical_rub_basis=None, historical_realized_result=None,
                interest_principal_allocation='requires chronological debt replay',
                request_sha256=hashlib.sha256(bytes.fromhex(tx['in_msg']['raw_body'])).hexdigest(),
                response_sha256=hashlib.sha256(bytes.fromhex(response['in_msg']['raw_body'])).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fetch-missing', action='store_true', help='Explicitly fetch missing public traces from TonAPI')
    args = parser.parse_args()
    accepted_path = 'crypto-task/chronological-rebuild/blocks/0701-0800/accepted/v1/evaa-evidence-links.json'
    accepted_bytes = git_bytes(accepted_path)
    events = [e for e in json.loads(accepted_bytes) if e.get('kind') == 'liquidation']
    ledger_path = PREFIX + 'evaa-debt-lifecycle/account-ledger.json'
    ledger_bytes = git_bytes(ledger_path)
    old = [e for e in json.loads(ledger_bytes) if e.get('kind') == 'liquidation']
    assert len(events) == len(old) == 4
    february = next(e for e in old if e['timestamp'] < events[0]['timestamp'])
    events.insert(0, february)
    report, sources = [], []
    for event in events:
        if 'event_no' in event:
            trace_path = args.evidence_dir / f"trace-{event['event_no']}.json"
            if not trace_path.exists() and args.fetch_missing:
                args.evidence_dir.mkdir(parents=True, exist_ok=True)
                with urllib.request.urlopen('https://tonapi.io/v2/traces/' + event['transaction'], timeout=30) as response:
                    trace_path.write_bytes(response.read())
            data = trace_path.read_bytes()
        else:
            data = git_bytes(PREFIX + 'evaa-ton-contract-ledger/sources/trace-1291.json')
        result = verify(event, json.loads(data))
        report.append(result)
        sources.append(dict(url='https://tonapi.io/v2/traces/' + event['transaction'],
                            sha256=hashlib.sha256(data).hexdigest()))
    assert sum(Decimal(r['collateral_paid']) for r in report if r['collateral_asset'] == 'TON') == Decimal('750.238957222')
    assert sum(Decimal(r['debt_payment']) for r in report if r['collateral_asset'] == 'TON') == Decimal('1441.852522')
    output = dict(source_ref=REF, source_files={accepted_path: hashlib.sha256(accepted_bytes).hexdigest(),
                  ledger_path: hashlib.sha256(ledger_bytes).hexdigest()},
                  scope='Verified historical quantities; NOT historical RUB costs or full bot replay',
                  events=report, traces=sources,
                  formula_source='https://github.com/evaafi/contracts/blob/1fb4e31dd7874391e34bae2cdfa5dd0d48b5d181/contracts/core/user-liquidate.fc')
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'Verified {len(report)} liquidations, including index rounding; RUB result remains uncomputed.')


if __name__ == '__main__':
    main()
