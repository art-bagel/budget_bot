"""Receipt scan: model answer sanitising, outgoing request, limits and the endpoint.

All receipt data here is made up.
"""

import asyncio
import dataclasses
import json
import os
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

os.environ.setdefault('APP_PORT', '8000')
os.environ.setdefault('DB_PORT', '5432')

from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import receipts  # noqa: E402
from backend.app.services import receipt_scan  # noqa: E402
from backend.app.services.receipt_scan import ReceiptScan, ReceiptScanError, parse_completion, scan_receipt  # noqa: E402

JPEG = b'\xff\xd8\xff\xe0' + b'MARKER-PHOTO-BYTES' + b'\x00' * 64
GOOD = {
    'merchant': 'Лавка у дома',
    'date': '2026-10-30',
    'currency': 'rub',
    'total': 144.80,
    'items': [
        {'name': 'ХЛЕБ БОРОД', 'name_ru': 'Хлеб бородинский', 'amount': 54.90},
        {'name': 'МОЛОКО 3,2%', 'name_ru': 'Молоко', 'amount': 89.90},
    ],
}


def completion(content, finish_reason='stop') -> dict:
    return {'choices': [{'message': {'content': content}, 'finish_reason': finish_reason}],
            'usage': {'prompt_tokens': 1, 'completion_tokens': 1}}


def answer(**overrides) -> dict:
    return completion(json.dumps({**GOOD, **overrides}))


def raw_answer(text: str) -> dict:
    return completion(text)


class ParseCompletionTests(unittest.TestCase):
    def test_good_answer_keeps_exact_amounts(self):
        scan = parse_completion(answer())
        self.assertEqual(scan.merchant, 'Лавка у дома')
        self.assertEqual(str(scan.date), '2026-10-30')
        self.assertEqual(scan.currency, 'RUB')
        self.assertEqual(scan.total, Decimal('144.80'))
        self.assertEqual([i.amount for i in scan.items], [Decimal('54.90'), Decimal('89.90')])
        body = json.loads(scan.model_dump_json())
        self.assertEqual(body['items'][0], {'name': 'ХЛЕБ БОРОД', 'name_ru': 'Хлеб бородинский', 'amount': '54.9'})
        exact = parse_completion(raw_answer('{"total": 144.80, "items": [{"name": "A", "name_ru": "A", "amount": 54.90}]}'))
        self.assertEqual(json.loads(exact.model_dump_json())['total'], '144.80', 'digits are kept as written')

    def test_whole_numbers_and_markdown_fence(self):
        text = '```json\n' + json.dumps({**GOOD, 'currency': 'VND', 'total': 1250000,
                                         'items': [{'name': 'COM', 'name_ru': 'Рис', 'amount': 1250000}]}) + '\n```'
        scan = parse_completion(raw_answer(text))
        self.assertEqual(json.loads(scan.model_dump_json())['total'], '1250000')

    def test_unusable_answers_fail(self):
        for case in (
            raw_answer('not json at all'),
            raw_answer('{"total": NaN, "items": []}'),
            raw_answer('{"total": Infinity, "items": []}'),
            raw_answer(json.dumps({**GOOD, 'items': 'none'})),
            raw_answer('[]'),
            completion(''),
            completion(None),
            completion(json.dumps(GOOD), finish_reason='length'),
            completion(json.dumps(GOOD), finish_reason='content_filter'),
            {'choices': [{'message': {'content': None, 'refusal': 'Не могу помочь'}, 'finish_reason': 'stop'}]},
            {'choices': []},
            {'error': {'message': 'budget exceeded'}},
        ):
            with self.subTest(case=str(case)[:80]), self.assertRaises(ReceiptScanError) as caught:
                parse_completion(case)
            self.assertEqual(str(caught.exception), 'Не удалось распознать чек')

    def test_bad_total_becomes_null(self):
        for total in ('144.80', -1, 10 ** 12, 1e400, 0.001, True, None, [1]):
            with self.subTest(total=total):
                text = json.dumps({**GOOD, 'total': total}) if total != 1e400 else \
                    json.dumps({**GOOD, 'total': 0}).replace('"total": 0', '"total": 1e400')
                self.assertIsNone(parse_completion(raw_answer(text)).total)

    def test_fields_are_cleaned(self):
        scan = parse_completion(answer(
            currency='рубли', date='вчера', merchant='\x00\x07  ' + 'Л' * 150,
        ))
        self.assertIsNone(scan.currency)
        self.assertIsNone(scan.date)
        self.assertEqual(scan.merchant, 'Л' * 100)
        self.assertIsNone(parse_completion(answer(merchant='\x01\x02')).merchant)
        self.assertEqual(str(parse_completion(answer(date='2026-10-30T21:08:00')).date), '2026-10-30')

    def test_items_are_cleaned(self):
        items = [
            {'name': 'ХЛЕБ\x00\x1b', 'name_ru': '', 'amount': 54.90},
            {'name': '', 'name_ru': 'Молоко\x7f', 'amount': 89.90},
            {'name': '  ', 'name_ru': '\x00', 'amount': 1},
            {'name': 'СКИДКА', 'name_ru': 'Скидка', 'amount': -10},
            {'name': 'ГВОЗДИ', 'name_ru': 'Гвозди', 'amount': 'сто'},
            {'name': 'ТОЧНО', 'name_ru': 'Слишком точно', 'amount': 0.001},
            {'name': 'ОГРОМНО', 'name_ru': 'Огромно', 'amount': 10 ** 12},
            'not an item',
            {'name': 'Д' * 300, 'name_ru': 'Д' * 300, 'amount': 5},
        ]
        scan = parse_completion(answer(items=items))
        self.assertEqual(
            [(i.name, i.name_ru, str(i.amount)) for i in scan.items],
            [('ХЛЕБ', 'ХЛЕБ', '54.9'), ('Молоко', 'Молоко', '89.9'), ('СКИДКА', 'Скидка', '-10'),
             ('Д' * 200, 'Д' * 200, '5')],
        )

    def test_missing_items_is_an_empty_list(self):
        for data in ({**GOOD, 'items': None}, {key: value for key, value in GOOD.items() if key != 'items'}):
            with self.subTest(keys=sorted(data)):
                scan = parse_completion(raw_answer(json.dumps(data)))
                self.assertEqual(scan.items, [])
                self.assertEqual(scan.total, Decimal('144.8'))

    def test_line_breaks_become_spaces_and_invisible_characters_go(self):
        items = [{'name': 'ХЛЕБ\nБОРОД\tИНСКИЙ', 'name_ru': 'Хлеб\u202e бородинский\u200b', 'amount': 1}]
        [item] = parse_completion(answer(items=items, merchant='Лавка\r\nу дома\u2066')).items
        self.assertEqual((item.name, item.name_ru), ('ХЛЕБ БОРОД ИНСКИЙ', 'Хлеб бородинский'))
        self.assertEqual(parse_completion(answer(merchant='Лавка\r\nу дома\u2066')).merchant, 'Лавка у дома')

    def test_at_most_200_items(self):
        items = [{'name': f'Товар {n}', 'name_ru': f'Товар {n}', 'amount': 1} for n in range(300)]
        self.assertEqual(len(parse_completion(answer(items=items)).items), 200)


class ScanReceiptTests(unittest.IsolatedAsyncioTestCase):
    async def scan(self, handler):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await scan_receipt(JPEG, api_url='https://llm.example/v1', api_key='secret-key',
                                      model='test-model', client=client)

    async def test_outgoing_request(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen['url'] = str(request.url)
            seen['auth'] = request.headers['authorization']
            seen['body'] = json.loads(request.content)
            return httpx.Response(200, json=answer())

        scan = await self.scan(handler)
        self.assertIsInstance(scan, ReceiptScan)
        self.assertEqual(seen['url'], 'https://llm.example/v1/chat/completions')
        self.assertEqual(seen['auth'], 'Bearer secret-key')
        body = seen['body']
        self.assertEqual(body['model'], 'test-model')
        self.assertEqual(body['reasoning'], {'effort': 'none'})
        self.assertNotIn('temperature', body)
        self.assertEqual(body['response_format']['type'], 'json_schema')
        image = body['messages'][0]['content'][1]['image_url']['url']
        self.assertTrue(image.startswith('data:image/jpeg;base64,/9j/'))
        self.assertNotIn('secret-key', json.dumps(body))

    async def test_provider_errors(self):
        for status in (402, 429, 500, 503):
            with self.subTest(status=status), self.assertRaises(ReceiptScanError) as caught:
                await self.scan(lambda request, s=status: httpx.Response(s, text='upstream says no'))
            self.assertEqual(caught.exception.reason, f'http {status}')
        with self.assertRaises(ReceiptScanError) as caught:
            await self.scan(lambda request: httpx.Response(200, text='<html>'))
        self.assertEqual(caught.exception.reason, 'bad answer')

    async def test_network_error(self):
        def handler(request):
            raise httpx.ConnectError('down')

        with self.assertRaises(ReceiptScanError) as caught:
            await self.scan(handler)
        self.assertEqual(caught.exception.reason, 'ConnectError')

    async def test_overall_deadline(self):
        async def handler(request):
            await asyncio.sleep(5)
            return httpx.Response(200, json=answer())

        with patch.object(receipt_scan, 'TIMEOUT_SECONDS', 0.05), self.assertRaises(ReceiptScanError) as caught:
            await self.scan(handler)
        self.assertEqual(caught.exception.reason, 'timeout')


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        receipts._calls.clear()
        receipts._in_flight.clear()
        self.user_id = 1
        self.app = FastAPI()
        self.app.include_router(receipts.router)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=self.user_id)
        self.flag = {'receipt_scan_enabled': True}
        self.scan_mock = AsyncMock(return_value=parse_completion(answer()))
        patches = [
            patch.object(receipts.context, 'get__user_context', AsyncMock(side_effect=lambda _id: self.flag)),
            patch.object(receipts, 'settings', dataclasses.replace(receipts.settings, receipt_scan_api_key='secret-key')),
            patch.object(receipts, 'scan_receipt', self.scan_mock),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    async def post(self, body: bytes = JPEG):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test') as client:
            return await client.post('/api/v1/receipts/scan', content=body,
                                     headers={'Content-Type': 'image/jpeg'})

    async def test_returns_scan(self):
        response = await self.post()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], '144.8')
        self.assertEqual(self.scan_mock.await_args.args[0], JPEG)
        self.assertEqual(self.scan_mock.await_args.kwargs['api_key'], 'secret-key')

    async def test_flag_off(self):
        for flag in ({'receipt_scan_enabled': False}, {}, None):
            self.flag = flag
            with self.subTest(flag=flag):
                response = await self.post()
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()['detail'], 'Распознавание чеков недоступно')
        self.scan_mock.assert_not_awaited()

    async def test_no_key(self):
        with patch.object(receipts, 'settings', dataclasses.replace(receipts.settings, receipt_scan_api_key=None)):
            response = await self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], 'Распознавание чеков не настроено')

    async def test_bad_body(self):
        big = b'\xff\xd8\xff' + b'\x00' * (3 * 1024 * 1024 - 2)
        for body in (b'', b'\x89PNG\r\n\x1a\n' + b'\x00' * 32, b'GIF89a', big):
            with self.subTest(size=len(body)):
                response = await self.post(body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {'detail': 'Нужна фотография в формате JPEG до 3 МБ'})
        self.scan_mock.assert_not_awaited()
        self.assertEqual(len(receipts._calls[self.user_id]), 0, '422 does not count against the limit')

    async def test_exactly_3_mb_passes(self):
        body = b'\xff\xd8\xff' + b'\x00' * (3 * 1024 * 1024 - 3)
        self.assertEqual((await self.post(body)).status_code, 200)

    async def test_hourly_limit_per_user(self):
        for _ in range(20):
            self.assertEqual((await self.post()).status_code, 200)
        response = await self.post()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['detail'], 'Слишком много чеков подряд, попробуйте через час')
        self.user_id = 2
        self.assertEqual((await self.post()).status_code, 200, 'other users are not affected')
        self.assertEqual(self.scan_mock.await_count, 21)

    async def test_failed_calls_count(self):
        self.scan_mock.side_effect = ReceiptScanError('http 500')
        for _ in range(20):
            self.assertEqual((await self.post()).status_code, 502)
        self.assertEqual((await self.post()).status_code, 429)

    async def test_one_scan_at_a_time(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow(*args, **kwargs):
            started.set()
            await release.wait()
            return parse_completion(answer())

        self.scan_mock.side_effect = slow
        first = asyncio.ensure_future(self.post())
        # A regression must fail the test, not hang the CI job.
        await asyncio.wait_for(started.wait(), 5)
        others = await asyncio.wait_for(asyncio.gather(*(self.post() for _ in range(24))), 5)
        self.assertEqual({r.status_code for r in others}, {429})
        self.assertEqual(others[0].json()['detail'], 'Чек уже распознаётся')
        release.set()
        self.assertEqual((await asyncio.wait_for(first, 5)).status_code, 200)
        self.assertEqual(self.scan_mock.await_count, 1)
        self.assertEqual((await self.post()).status_code, 200, 'slot is released')

    async def test_failure_log_has_no_content(self):
        self.scan_mock.side_effect = ReceiptScanError('http 402')
        with self.assertLogs('backend.app.routers.receipts', level='WARNING') as logs:
            response = await self.post()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()['detail'], 'Не удалось распознать чек')
        text = '\n'.join(logs.output)
        self.assertIn('http 402', text)
        self.assertIn('user 1', text)
        for leaked in ('MARKER', '/9j/', 'secret-key'):
            self.assertNotIn(leaked, text)

    async def test_bad_model_answer_is_not_logged(self):
        async def call(jpeg, **kwargs):
            return parse_completion(raw_answer('{"items": "MARKER-SECRET-RECEIPT"}'))

        self.scan_mock.side_effect = call
        with self.assertLogs('backend.app.routers.receipts', level='WARNING') as logs:
            response = await self.post()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('MARKER-SECRET-RECEIPT', '\n'.join(logs.output))
        self.assertNotIn('MARKER-SECRET-RECEIPT', response.text)


if __name__ == '__main__':
    unittest.main()
