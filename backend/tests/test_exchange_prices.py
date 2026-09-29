import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx
from backend.app.exchange_prices import CACHE, bybit_prices

ETH = dict(id=24, symbol="ETH", network_code="ethereum", contract_address="service:bybit:ETH")
USDT_RUB = [dict(price=84.0, fetched_at=datetime.now(timezone.utc).isoformat())]


class BybitPricesTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        CACHE.clear()

    async def test_usdt_pair_converted_with_tonapi_usdt_rate(self):
        response = httpx.Response(
            200,
            json={"result": {"list": [{"lastPrice": "2700.5"}]}},
            request=httpx.Request("GET", "https://api.bybit.com"),
        )
        with patch("backend.app.exchange_prices.token_prices", AsyncMock(return_value=USDT_RUB)), \
                patch("backend.app.exchange_prices.httpx.AsyncClient") as factory:
            get = AsyncMock(return_value=response)
            factory.return_value.__aenter__.return_value.get = get
            rows = await bybit_prices([ETH, dict(ETH, id=9, network_code="ton")], "rub")
        self.assertEqual([(r["crypto_asset_id"], r["price"], r["source"]) for r in rows],
                         [(24, 2700.5 * 84.0, "bybit")])
        self.assertEqual(get.await_args.kwargs["params"]["symbol"], "ETHUSDT")

    async def test_no_price_without_usdt_rate_or_ticker(self):
        with patch("backend.app.exchange_prices.token_prices", AsyncMock(return_value=[])):
            self.assertEqual(await bybit_prices([ETH], "rub"), [])
        with patch("backend.app.exchange_prices.token_prices", AsyncMock(return_value=USDT_RUB)), \
                patch("backend.app.exchange_prices.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.ConnectError("offline"))
            self.assertEqual(await bybit_prices([ETH], "rub"), [])


if __name__ == "__main__":
    unittest.main()
