"""
Receipt recognition by a vision model behind an OpenAI-compatible API (aitunnel).

The model's answer is untrusted input: it is parsed strictly and every field is
cleaned here, so the router only ever sees a ReceiptScan. Nothing in this module
logs: ReceiptScanError.reason carries a short content-free cause for the caller.
"""

import asyncio
import base64
import datetime
import json
import re
from decimal import Decimal
from typing import List, Optional

import httpx
from pydantic import BaseModel


TIMEOUT_SECONDS = 40  # below nginx proxy_read_timeout (60 s)
MAX_ITEMS = 200
MAX_AMOUNT = Decimal(10) ** 12
FAILED = 'Не удалось распознать чек'

PROMPT = """You read a photo of a shop receipt or a payment terminal screen (any country, any language). Return JSON only.
- items: every purchased line in receipt order. name = product text exactly as printed; name_ru = short clear
  Russian name of the product (translate if not Russian, expand abbreviations); amount = line total
  (negative for a discount line).
- total = final amount paid.
- currency = ISO 4217 code of the receipt currency, null if unsure.
- Numbers: plain JSON numbers, '.' as decimal point, no thousands separators. Separators differ by country:
  in VND receipts '250.000' means 250000.
- Skip everything that is not a purchased item: ads, coupons, VAT breakdown, payment method, card digits,
  cashier, register and fiscal numbers, tax ids, addresses. Discounts already reflected in line totals must
  not be subtracted again.
- merchant = shop name; date = purchase date (ISO 8601); null if not visible."""

_NUMBER = {'type': 'number'}
SCHEMA = {
    'type': 'object',
    'properties': {
        'merchant': {'type': ['string', 'null']},
        'date': {'type': ['string', 'null']},
        'currency': {'type': ['string', 'null']},
        'total': {'type': ['number', 'null']},
        'items': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {'name': {'type': 'string'}, 'name_ru': {'type': 'string'}, 'amount': _NUMBER},
                'required': ['name', 'name_ru', 'amount'],
            },
        },
    },
    'required': ['merchant', 'date', 'currency', 'total', 'items'],
}

# Control characters become spaces (a line break must not glue two words); bidi
# overrides and zero-width characters are dropped: they could reorder or hide text
# in operations.comment.
_CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f]')
_INVISIBLE = re.compile('[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]')
_SPACES = re.compile(r'\s+')
_CURRENCY = re.compile(r'[A-Z]{3}')
_FENCE = re.compile(r'^```(?:json)?\s*|\s*```$')


class ReceiptItem(BaseModel):
    name: str
    name_ru: str
    amount: Decimal


class ReceiptScan(BaseModel):
    merchant: Optional[str] = None
    date: Optional[datetime.date] = None
    currency: Optional[str] = None
    total: Optional[Decimal] = None
    items: List[ReceiptItem] = []


class ReceiptScanError(Exception):
    """The user sees FAILED; reason is a content-free cause for the log."""

    def __init__(self, reason: str):
        super().__init__(FAILED)
        self.reason = reason


def _reject_constant(name: str):
    raise ValueError(f'{name} is not a number')


def _text(value, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = _SPACES.sub(' ', _CONTROL.sub(' ', _INVISIBLE.sub('', value))).strip()[:limit].strip()
    return cleaned or None


def _amount(value, *, allow_negative: bool) -> Optional[Decimal]:
    # bool is an int in Python, and JSON true is not an amount.
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)):
        return None
    amount = Decimal(value)
    if not amount.is_finite() or abs(amount) >= MAX_AMOUNT or amount.as_tuple().exponent < -2:
        return None
    if amount < 0 and not allow_negative:
        return None
    # 1E+3 would reach the client as "1E+3".
    return amount.quantize(Decimal(1)) if amount.as_tuple().exponent > 0 else amount


def _date(value) -> Optional[datetime.date]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def _currency(value) -> Optional[str]:
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    return code if _CURRENCY.fullmatch(code) else None


def _items(raw_items: list) -> List[ReceiptItem]:
    items = []
    for raw in raw_items[:MAX_ITEMS]:
        if not isinstance(raw, dict):
            continue
        name = _text(raw.get('name'), 200)
        name_ru = _text(raw.get('name_ru'), 200) or name
        amount = _amount(raw.get('amount'), allow_negative=True)
        if name_ru is None or amount is None:
            continue
        items.append(ReceiptItem(name=name or name_ru, name_ru=name_ru, amount=amount))
    return items


def parse_completion(raw) -> ReceiptScan:
    """
    Turns a chat-completion response into a clean ReceiptScan.
    :param raw: Decoded JSON body of the provider response.
    :return: Cleaned scan; unusable fields become None, unusable items are dropped.
    :raises ReceiptScanError: The answer as a whole cannot be used.
    """
    try:
        choice = raw['choices'][0]
        message = choice['message']
        content = message.get('content')
        finish_reason = choice.get('finish_reason')
    except (KeyError, IndexError, TypeError, AttributeError):
        raise ReceiptScanError('bad answer') from None

    if message.get('refusal') or finish_reason in ('length', 'content_filter'):
        raise ReceiptScanError(f'finish {finish_reason or "refusal"}')
    if not isinstance(content, str) or not content.strip():
        raise ReceiptScanError('empty answer')

    try:
        data = json.loads(_FENCE.sub('', content.strip()), parse_float=Decimal, parse_constant=_reject_constant)
    except ValueError:
        raise ReceiptScanError('bad json') from None
    # items: null is a receipt without readable lines (a terminal screen), not garbage.
    if not isinstance(data, dict) or not isinstance(data.get('items') or [], list):
        raise ReceiptScanError('bad json')

    return ReceiptScan(
        merchant=_text(data.get('merchant'), 100),
        date=_date(data.get('date')),
        currency=_currency(data.get('currency')),
        total=_amount(data.get('total'), allow_negative=False),
        items=_items(data.get('items') or []),
    )


async def _post(client: httpx.AsyncClient, url: str, api_key: str, body: dict) -> httpx.Response:
    return await client.post(url, json=body, headers={'Authorization': f'Bearer {api_key}'})


async def scan_receipt(
    jpeg: bytes,
    *,
    api_url: str,
    api_key: str,
    model: str,
    client: Optional[httpx.AsyncClient] = None,
) -> ReceiptScan:
    """
    Sends one receipt photo to the model and returns the cleaned result.
    :param jpeg: JPEG bytes, already checked by the caller.
    :param api_url: Base URL of the OpenAI-compatible API.
    :param api_key: Provider key; goes only into the Authorization header.
    :param model: Model id at the provider.
    :param client: HTTP client for tests; a fresh one is used otherwise.
    :return: Cleaned scan.
    :raises ReceiptScanError: Provider failed, timed out or answered with garbage.
    """
    image = 'data:image/jpeg;base64,' + base64.b64encode(jpeg).decode()
    body = {
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': PROMPT},
            {'type': 'image_url', 'image_url': {'url': image}},
        ]}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'receipt', 'schema': SCHEMA}},
        # Reasoning made cheap models twice as slow and less accurate on receipts.
        'reasoning': {'effort': 'none'},
        'max_tokens': 8000,
    }
    url = api_url.rstrip('/') + '/chat/completions'

    try:
        # httpx timeouts apply per phase; this is the deadline for the whole call.
        if client is None:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as own_client:
                response = await asyncio.wait_for(_post(own_client, url, api_key, body), TIMEOUT_SECONDS)
        else:
            response = await asyncio.wait_for(_post(client, url, api_key, body), TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise ReceiptScanError('timeout') from None
    except httpx.HTTPError as exc:
        raise ReceiptScanError(type(exc).__name__) from None

    if response.status_code != 200:
        raise ReceiptScanError(f'http {response.status_code}')
    try:
        raw = response.json()
    except ValueError:
        raise ReceiptScanError('bad answer') from None
    return parse_completion(raw)
