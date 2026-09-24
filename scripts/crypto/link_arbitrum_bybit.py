"""Link raw Bybit withdrawals to accounting gross amounts; no invented RUB basis."""

import argparse
from datetime import datetime, timezone
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path


def build(directory, source):
    boundary = json.loads((directory / "bybit-boundary.json").read_text())
    accounting = json.loads(source.read_text())
    links = []
    for item in boundary:
        b = item["row"]
        if b["Type"] != "Withdraw":
            continue
        t = datetime.fromisoformat(b["Date"]).replace(tzinfo=timezone.utc)
        candidates = []
        for row in accounting:
            if row["Актив"] != b["Asset"] or row["Тип"] != "Withdraw":
                continue
            rt = datetime.fromisoformat(row["Дата"] + "T" + row["Время"]).replace(
                tzinfo=timezone.utc
            )
            if abs((rt - t).total_seconds()) <= 120:
                candidates.append(row)
        assert len(candidates) == 1, (b, candidates)
        row = candidates[0]
        gross = -D(row["Изменение"].replace(",", "."))
        net = D(b["Amount"])
        assert gross >= net > 0
        links.append(
            dict(
                tx_hash=b["Tx ID"],
                symbol=b["Asset"],
                source_line=row["_source_line"],
                source_id="bybit:row:" + str(row["_source_line"]),
                gross=str(gross),
                received=str(net),
                exchange_fee=str(gross - net),
                occurred_at=b["Date"],
                rule="Gross basis splits proportionally into net transfer and exchange fee; carry all loan components",
            )
        )
    assert len(links) == 8
    relevant = [
        r for r in accounting if r["Дата"] in ("2025-10-12", "2026-02-01", "2026-02-03")
    ]
    result = dict(
        source=str(source),
        sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        links=links,
        related_exchange_rows=relevant,
        pending="Replay at original timestamps against exchange WAC; no standalone assumed-zero valuation",
    )
    (directory / "funding-links.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(links, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", type=Path, required=True)
    p.add_argument("--source", type=Path, required=True)
    args = p.parse_args()
    build(args.directory, args.source)
