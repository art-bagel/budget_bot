import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

os.environ.setdefault('APP_PORT', '8000')
os.environ.setdefault('DB_PORT', '5432')

from backend.app.routers.portfolio import parse_telegram_gift, telegram_gift  # noqa: E402

PAGE = '''<meta property="og:title" content="Plush Pepe #1">
<meta property="og:image" content="https://cdn4.telesco.pe/file/py_abc.jpg">
<table class="table tgme_gift_table"><tbody>
<tr><th>Owner</th><td><span dir="auto">Pavel Durov</span></td></tr><tr><th>Model</th><td>Pumpkin <mark>3%</mark></td></tr><tr><th>Backdrop</th><td>Onyx Black <mark>2%</mark></td></tr><tr><th>Symbol</th><td>Illuminati <mark>0.5%</mark></td></tr><tr><th>Quantity</th><td>2 825/2 861 issued</td></tr>
</tbody></table>'''
MISSING = '<meta property="og:title" content="Telegram – a new era of messaging">'


def fetched(page: str, status: int = 200):
    factory = patch('backend.app.routers.portfolio.httpx.AsyncClient')
    response = httpx.Response(status, text=page, request=httpx.Request('GET', 'https://t.me'))
    return factory, AsyncMock(return_value=response)


class TelegramGiftTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_traits_with_rarity(self):
        self.assertEqual(parse_telegram_gift(PAGE), {
            'title': 'Plush Pepe #1', 'collection': 'Plush Pepe', 'number': '1',
            'model': 'Pumpkin 3%', 'backdrop': 'Onyx Black 2%', 'symbol': 'Illuminati 0.5%',
            'link': 'https://t.me/nft/PlushPepe-1', 'image': 'https://cdn4.telesco.pe/file/py_abc.jpg',
        })
        self.assertIsNone(parse_telegram_gift(MISSING))
        # A preview that is not an https link is dropped rather than stored.
        self.assertIsNone(parse_telegram_gift(PAGE.replace('https://cdn4', 'http://cdn4'))['image'])
        durov = parse_telegram_gift(PAGE.replace('Plush Pepe #1', 'Durov’s Cap #1'))
        self.assertEqual((durov['collection'], durov['link']), ('Durov’s Cap', 'https://t.me/nft/DurovsCap-1'))

    async def test_lookup_builds_canonical_link_from_loose_input(self):
        factory, get = fetched(PAGE)
        with factory as client:
            client.return_value.__aenter__.return_value.get = get
            gift = await telegram_gift(collection="plush pepe", number='1', user=None)
            await telegram_gift(collection="durov's cap", number='1', user=None)
        self.assertEqual([call.args[0] for call in get.await_args_list],
                         ['https://t.me/nft/plushpepe-1', 'https://t.me/nft/durovscap-1'])
        self.assertEqual((gift.title, gift.link), ('Plush Pepe #1', 'https://t.me/nft/PlushPepe-1'))

    async def test_missing_gift_and_network_errors_are_not_found(self):
        factory, get = fetched(MISSING)
        with factory as client:
            client.return_value.__aenter__.return_value.get = get
            with self.assertRaises(HTTPException) as missing:
                await telegram_gift(collection='PlushPepe', number='99999999', user=None)
            client.return_value.__aenter__.return_value.get = AsyncMock(side_effect=httpx.ConnectError('down'))
            with self.assertRaises(HTTPException) as down:
                await telegram_gift(collection='PlushPepe', number='1', user=None)
        self.assertEqual((missing.exception.status_code, down.exception.status_code), (404, 404))

    async def test_rejects_anything_but_a_slug_and_digits(self):
        with patch('backend.app.routers.portfolio.httpx.AsyncClient') as client:
            for collection, number in (('../x', '1'), ('Plush Pepe', '1a'), ('Плюш', '1'), ('PlushPepe', ''), ('PlushPepe', '1234567890')):
                with self.assertRaises(HTTPException) as error:
                    await telegram_gift(collection=collection, number=number, user=None)
                self.assertEqual(error.exception.status_code, 400)
        client.assert_not_called()


if __name__ == '__main__':
    unittest.main()
