import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.services.fx_rates import CACHE_TTL_SECONDS, CBR_URL, FxRates, parse_cbr_rates


XML = b'''<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="03.10.2026">
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>80,0000</Value></Valute>
  <Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>90,0000</Value></Valute>
  <Valute><CharCode>EGP</CharCode><Nominal>10</Nominal><Value>16,0000</Value></Valute>
  <Valute><CharCode>TRY</CharCode><Nominal>10</Nominal><Value>20,0000</Value></Valute>
  <Valute><CharCode>JPY</CharCode><Nominal>100</Nominal><Value>50,0000</Value></Valute>
</ValCurs>'''


class CbrParsingTests(unittest.TestCase):
    def test_rates_are_per_unit_including_non_unit_nominal(self):
        date, rates = parse_cbr_rates(XML)
        self.assertEqual(date, '2026-10-03')
        self.assertEqual(rates, dict(RUB=Decimal(1), USD=Decimal(80), EUR=Decimal(90),
                                     EGP=Decimal('1.6'), TRY=Decimal(2), JPY=Decimal('0.5')))

    def test_rejects_invalid_rate_data(self):
        for invalid in (b'0', b'-1', b'NaN', b'Infinity'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_cbr_rates(XML.replace(b'16,0000', invalid))
        with self.assertRaises(ValueError):
            parse_cbr_rates(XML.replace(b'<Nominal>10</Nominal>', b'<Nominal>0</Nominal>'))
        with self.assertRaises(ValueError):
            parse_cbr_rates(b'<ValCurs Date="03.10.2026"/>')


class FxRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.service = FxRates()
        self.reports = AsyncMock()
        self.reports.get__currencies.return_value = [
            {'code': code} for code in ('RUB', 'USD', 'EUR', 'EGP', 'TRY')
        ]
        self.ledger = AsyncMock()
        self.factory = patch('backend.app.services.fx_rates.httpx.AsyncClient').start()
        self.addCleanup(patch.stopall)
        self.get = self.factory.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=httpx.Response(200, content=XML, request=httpx.Request('GET', CBR_URL)),
        )

    async def test_all_registered_pairs_persisted_with_correct_orientation_and_cached(self):
        result = await self.service.get(self.reports, self.ledger)
        self.assertEqual(result['rub_per_unit']['EGP'], 1.6)
        self.assertNotIn('JPY', result['rub_per_unit'])
        calls = self.ledger.put__record_fx_rate_snapshot.await_args_list
        self.assertEqual(len(calls), 20)
        pairs = {(call.args[0], call.args[1]): call.args[2] for call in calls}
        self.assertEqual(pairs['RUB', 'EGP'], Decimal('1.6'))
        self.assertEqual(pairs['TRY', 'EGP'], Decimal('0.8'))
        self.assertEqual(pairs['EGP', 'USD'], Decimal(50))
        self.assertEqual(pairs['EGP', 'RUB'], Decimal('0.625'))
        self.assertEqual(len({call.args[3] for call in calls}), 1)
        self.assertEqual(await self.service.get(self.reports, self.ledger), result)
        self.get.assert_awaited_once()

    async def test_expired_cache_refreshes_on_the_next_request(self):
        with patch('backend.app.services.fx_rates.time') as clock:
            clock.monotonic.return_value = 100
            await self.service.get(self.reports, self.ledger)
            clock.monotonic.return_value = 100 + CACHE_TTL_SECONDS - 1
            await self.service.get(self.reports, self.ledger)
            self.get.assert_awaited_once()
            clock.monotonic.return_value = 100 + CACHE_TTL_SECONDS
            self.get.return_value = httpx.Response(
                200, content=XML.replace(b'16,0000', b'17,0000'),
                request=httpx.Request('GET', CBR_URL),
            )
            result = await self.service.get(self.reports, self.ledger)
        self.assertEqual(self.get.await_count, 2)
        self.assertEqual(result['rub_per_unit']['EGP'], 1.7)

    async def test_failure_keeps_old_snapshot_and_does_not_write_new_rates(self):
        before = await self.service.get(self.reports, self.ledger)
        self.service._next_refresh = 0
        self.get.side_effect = httpx.ConnectError('offline')
        with self.assertLogs('backend.app.services.fx_rates', level='ERROR'):
            after = await self.service.get(self.reports, self.ledger)
        self.assertEqual(after, before)
        self.assertEqual(self.ledger.put__record_fx_rate_snapshot.await_count, 20)

    async def test_first_failure_does_not_invent_rates_and_is_throttled(self):
        self.get.side_effect = httpx.ConnectError('offline')
        with self.assertLogs('backend.app.services.fx_rates', level='ERROR'):
            with self.assertRaises(httpx.ConnectError):
                await self.service.get(self.reports, self.ledger)
        with self.assertRaises(ValueError):
            await self.service.get(self.reports, self.ledger)
        self.get.assert_awaited_once()
        self.ledger.put__record_fx_rate_snapshot.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
