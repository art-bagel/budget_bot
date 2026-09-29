import base64
import binascii
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from backend.app.ton_prices import CACHE, master_address, token_prices

MASTER = "0:" + "12" * 32
ASSET = dict(id=3, symbol="ANY", network_code="ton", contract_address=MASTER)


class TonPricesTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        CACHE.clear()

    def test_contract_identity(self):
        raw = bytes([0x51, 0]) + bytes.fromhex("12" * 32)
        friendly = base64.urlsafe_b64encode(
            raw + binascii.crc_hqx(raw, 0).to_bytes(2, "big")
        ).decode()
        self.assertEqual(master_address(dict(ASSET, contract_address=friendly)), MASTER)
        self.assertIsNone(master_address(dict(ASSET, network_code="ethereum")))
        self.assertIsNone(master_address(dict(ASSET, contract_address="JETTON")))
        self.assertIsNone(
            master_address(dict(ASSET, contract_address=friendly[:-1] + "A"))
        )
        native = dict(ASSET, symbol="TON", contract_address="")
        self.assertEqual(master_address(native), "TON")
        self.assertEqual(master_address(dict(native, symbol="GRAM")), "GRAM")
        self.assertIsNone(master_address(dict(native, symbol="USDT")))
        self.assertIsNone(master_address(dict(native, network_code="manual")))
        self.assertIsNone(master_address(dict(ASSET, network_code="telegram",
                                              contract_address="service:telegram:DOGS")))

    async def test_native_ton_is_quoted(self):
        response = httpx.Response(
            200,
            json={"rates": {"TON": {"prices": {"RUB": 133.8}}}},
            request=httpx.Request("GET", "https://tonapi.io"),
        )
        with patch("backend.app.ton_prices.httpx.AsyncClient") as factory:
            get = AsyncMock(return_value=response)
            factory.return_value.__aenter__.return_value.get = get
            rows = await token_prices(
                [dict(ASSET, id=1, symbol="TON", contract_address="")], "rub"
            )
        self.assertEqual([(r["crypto_asset_id"], r["price"]) for r in rows], [(1, 133.8)])
        self.assertEqual(get.await_args.kwargs["params"]["tokens"], "TON")

    async def test_quote_currency_cache_and_multiple_asset_ids(self):
        response = httpx.Response(
            200,
            json={"rates": {MASTER: {"prices": {"RUB": 123, "USD": 1.5}}}},
            request=httpx.Request("GET", "https://tonapi.io"),
        )
        with patch("backend.app.ton_prices.httpx.AsyncClient") as factory:
            get = AsyncMock(return_value=response)
            factory.return_value.__aenter__.return_value.get = get
            rows = await token_prices([ASSET, dict(ASSET, id=4)], "rub")
            self.assertEqual([r["price"] for r in rows], [123, 123])
            self.assertTrue(
                all(r["source"] == "tonapi" and not r["is_stale"] for r in rows)
            )
            await token_prices([ASSET], "RUB")
            self.assertEqual(get.await_count, 1)
            usd = await token_prices([ASSET], "usd")
            self.assertEqual(usd[0]["price"], 1.5)
            self.assertEqual(get.await_count, 2)

    async def test_failed_refresh_is_stale_and_expires(self):
        CACHE[MASTER, "RUB"] = (datetime.now(timezone.utc) - timedelta(minutes=3), 10)
        with patch("backend.app.ton_prices.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.ConnectError("offline")
            )
            rows = await token_prices([ASSET], "rub")
            self.assertTrue(rows[0]["is_stale"])
            self.assertGreaterEqual(rows[0]["stale_age_seconds"], 180)
            CACHE[MASTER, "RUB"] = (
                datetime.now(timezone.utc) - timedelta(minutes=31),
                10,
            )
            self.assertEqual(await token_prices([ASSET], "rub"), [])

    async def test_invalid_or_wrong_contract_data_not_priced(self):
        for payload in [
            {"rates": {MASTER: {"prices": {"RUB": -1}}}},
            {"rates": {MASTER: {"prices": {"RUB": True}}}},
            {"rates": {"wrong": {"prices": {"RUB": 10}}}},
            {"rates": []},
        ]:
            response = httpx.Response(
                200, json=payload, request=httpx.Request("GET", "https://tonapi.io")
            )
            with patch("backend.app.ton_prices.httpx.AsyncClient") as factory:
                factory.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=response
                )
                self.assertEqual(await token_prices([ASSET], "rub"), [])


if __name__ == "__main__":
    unittest.main()
