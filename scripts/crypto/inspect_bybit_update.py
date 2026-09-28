"""Read-only inventory of a Bybit CSV delivery, preserving source rows and hashes."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path

TIME_COLUMNS = ('Date & Time(UTC)', 'Transaction Date & Time', 'Date',
                'Invested Time (UTC)', 'Redemption Time (UTC)', 'Distribution time')


def inspect(source, cutoff):
    files = []
    for path in sorted(source.rglob('*')):
        if path.suffix.lower() not in ('.csv', '.pdf'):
            continue
        raw = path.read_bytes()
        item = dict(path=str(path.relative_to(source)), sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
        if path.suffix.lower() == '.csv':
            lines = raw.decode('utf-8-sig').splitlines()
            # Bybit prepends a UID/company/country line before the CSV header.
            skip = 1 if lines and lines[0].startswith('UID:') else 0
            reader = csv.DictReader(lines[skip:])
            assert reader.fieldnames and len(reader.fieldnames) == len(set(reader.fieldnames)), path
            column = next((c for c in TIME_COLUMNS if c in reader.fieldnames), None)
            assert column is not None, f'Unknown timestamp column: {path.name}'
            rows = []
            totals = defaultdict(Decimal)
            for number, row in enumerate(reader, skip + 2):
                assert None not in row and all(v is not None for v in row.values()), (path, number)
                stamp = datetime.strptime(row[column], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                after = stamp > cutoff
                rows.append(dict(source_row=number, timestamp_as_exported=row[column], after_cutoff=after, values=row))
                if after and 'QTY' in row:
                    totals[(row['Coin'], row['Type'], row['Description'])] += Decimal(row['QTY'])
            dates = [r['timestamp_as_exported'] for r in rows]
            item.update(columns=reader.fieldnames, row_count=len(rows), after_cutoff_count=sum(r['after_cutoff'] for r in rows),
                        min_timestamp=min(dates) if dates else None, max_timestamp=max(dates) if dates else None,
                        type_counts=dict(Counter(r['values'].get('Type', 'record') for r in rows)), rows=rows,
                        after_cutoff_totals=[dict(coin=k[0], type=k[1], description=k[2], quantity=str(v)) for k,v in sorted(totals.items())])
        files.append(item)
    assert files, 'No CSV or PDF files found'
    return dict(source=str(source.resolve()), cutoff_utc=cutoff.isoformat(), files=files,
                notes=['CSV timestamps interpreted as UTC for overlap screening; original strings retained.',
                       'FREEZE and DEDUCT card rows are separate lifecycle records, not two expenses.',
                       'Earn detail reports overlap Funding Account movements; do not add both.',
                       'Source files unmodified. No database operations performed.'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--cutoff', required=True, help='Timezone-aware ISO timestamp')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    cutoff = datetime.fromisoformat(args.cutoff)
    assert cutoff.tzinfo is not None, 'Cutoff needs timezone'
    result = inspect(args.source, cutoff.astimezone(timezone.utc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps([dict(file=f['path'], rows=f.get('row_count'), after_cutoff=f.get('after_cutoff_count')) for f in result['files']], ensure_ascii=False))
