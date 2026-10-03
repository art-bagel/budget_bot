"""Official fiat rates, in base-currency units per one quote-currency unit."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from xml.etree import ElementTree

import httpx

from storage.ledger import Ledger
from storage.reports import Reports

logger = logging.getLogger(__name__)
CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp'
# Requests may reuse a recent snapshot; no timer refreshes it in the background.
CACHE_TTL_SECONDS = 3600


def parse_cbr_rates(content: bytes) -> tuple[str, dict[str, Decimal]]:
    root = ElementTree.fromstring(content)
    if root.tag != 'ValCurs':
        raise ValueError('Unexpected CBR response')
    rate_date = datetime.strptime(root.attrib['Date'], '%d.%m.%Y').date().isoformat()
    rates = {'RUB': Decimal(1)}
    for item in root.findall('Valute'):
        code = item.findtext('CharCode', '').strip()
        nominal = Decimal(item.findtext('Nominal', '').replace(',', '.'))
        value = Decimal(item.findtext('Value', '').replace(',', '.'))
        if (len(code) != 3 or not code.isalpha() or code != code.upper()
                or not nominal.is_finite() or nominal <= 0
                or not value.is_finite() or value <= 0):
            raise ValueError('Invalid CBR currency rate')
        rates[code] = value / nominal
    if len(rates) == 1:
        raise ValueError('Empty CBR rates')
    return rate_date, rates


class FxRates:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._next_refresh = 0.0
        self._snapshot: dict | None = None

    async def get(self, reports: Reports, ledger: Ledger) -> dict:
        async with self._lock:
            if time.monotonic() < self._next_refresh:
                if self._snapshot is None:
                    raise ValueError('FX rates unavailable')
                return self._snapshot
            try:
                currencies = await reports.get__currencies()
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    response = await client.get(CBR_URL)
                    response.raise_for_status()
                rate_date, rates = parse_cbr_rates(response.content)
                supported = {c['code']: rates[c['code']] for c in currencies if c['code'] in rates}
                fetched_at = datetime.now(timezone.utc)
                # One timestamp for all pairs; cross rates support non-RUB base currencies.
                await asyncio.gather(*(
                    ledger.put__record_fx_rate_snapshot(
                        base, quote, quote_rate / base_rate, fetched_at, 'cbr',
                    )
                    for base, base_rate in supported.items()
                    for quote, quote_rate in supported.items() if base != quote
                ))
                self._snapshot = {
                    'source': 'cbr', 'rate_date': rate_date,
                    'fetched_at': fetched_at.isoformat(),
                    'rub_per_unit': {code: float(rate) for code, rate in supported.items()},
                }
                self._next_refresh = time.monotonic() + CACHE_TTL_SECONDS
            except Exception:
                self._next_refresh = time.monotonic() + 60
                logger.exception('Failed to refresh CBR exchange rates')
                if self._snapshot is None:
                    raise
            return self._snapshot


fx_rates = FxRates()
