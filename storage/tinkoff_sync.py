"""
Tinkoff Investments sync module.

Uses the Tinkoff Invest REST API (gRPC-gateway) directly via httpx.
No third-party SDK required — only httpx (standard package).

REST base: https://invest-public-api.tinkoff.ru/rest
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import asyncpg
import httpx


TINKOFF_REST_URL = 'https://invest-public-api.tinkoff.ru/rest'
logger = logging.getLogger(__name__)

# Tinkoff operation type → our internal kind
_OP_TYPE_MAP: dict[str, str] = {
    # Cash flows
    'OPERATION_TYPE_INPUT':                         'input',
    'OPERATION_TYPE_OUTPUT':                        'output',
    'OPERATION_TYPE_INPUT_SWIFT':                   'input',
    'OPERATION_TYPE_OUTPUT_SWIFT':                  'output',
    'OPERATION_TYPE_INPUT_ACQUIRING':               'input',
    'OPERATION_TYPE_OUTPUT_ACQUIRING':              'output',
    'OPERATION_TYPE_TRANSFER':                      'input',
    'OPERATION_TYPE_DIV_EXT':                       'dividend',  # дивиденды на карту
    # Trades
    'OPERATION_TYPE_BUY':                           'buy',
    'OPERATION_TYPE_BUY_CARD':                      'buy',
    'OPERATION_TYPE_BUY_MARGIN':                    'buy',
    'OPERATION_TYPE_SELL':                          'sell',
    'OPERATION_TYPE_SELL_CARD':                     'sell',
    'OPERATION_TYPE_SELL_MARGIN':                   'sell',
    'OPERATION_TYPE_DELIVERY_BUY':                  'buy',
    'OPERATION_TYPE_DELIVERY_SELL':                 'sell',
    # Income
    'OPERATION_TYPE_DIVIDEND':                      'dividend',
    'OPERATION_TYPE_DIVIDEND_TRANSFER':             'dividend',
    'OPERATION_TYPE_COUPON':                        'coupon',
    'OPERATION_TYPE_BOND_REPAYMENT':                'bond_repayment',
    'OPERATION_TYPE_BOND_REPAYMENT_FULL':           'bond_repayment_full',
    'OPERATION_TYPE_ACCRUING_VARMARGIN':            'coupon',   # вариационная маржа зачисление
    # Taxes
    'OPERATION_TYPE_TAX':                           'tax',
    'OPERATION_TYPE_DIVIDEND_TAX':                  'tax',      # удержание налога по дивидендам
    'OPERATION_TYPE_BOND_TAX':                      'tax',      # удержание налога по купонам
    'OPERATION_TYPE_BENEFIT_TAX':                   'tax',      # налог на матвыгоду
    'OPERATION_TYPE_TAX_PROGRESSIVE':               'tax',
    'OPERATION_TYPE_BOND_TAX_PROGRESSIVE':          'tax',
    'OPERATION_TYPE_DIVIDEND_TAX_PROGRESSIVE':      'tax',
    'OPERATION_TYPE_BENEFIT_TAX_PROGRESSIVE':       'tax',
    'OPERATION_TYPE_TAX_CORRECTION':                'tax',
    'OPERATION_TYPE_TAX_CORRECTION_PROGRESSIVE':    'tax',
    'OPERATION_TYPE_TAX_CORRECTION_COUPON':         'tax',
    'OPERATION_TYPE_TAX_REPO':                      'tax',
    'OPERATION_TYPE_TAX_REPO_HOLD':                 'tax',
    'OPERATION_TYPE_TAX_REPO_REFUND':               'tax',
    'OPERATION_TYPE_TAX_REPO_PROGRESSIVE':          'tax',
    'OPERATION_TYPE_TAX_REPO_HOLD_PROGRESSIVE':     'tax',
    'OPERATION_TYPE_TAX_REPO_REFUND_PROGRESSIVE':   'tax',
    'OPERATION_TYPE_TAX_BOND_COUPON':               'tax',
    'OPERATION_TYPE_BENEFIT_TAX_COUPON':            'tax',
    # Fees
    'OPERATION_TYPE_BROKER_FEE':                    'broker_fee',
    'OPERATION_TYPE_SERVICE_FEE':                   'broker_fee',
    'OPERATION_TYPE_MARGIN_FEE':                    'broker_fee',
    'OPERATION_TYPE_SUCCESS_FEE':                   'broker_fee',
    'OPERATION_TYPE_TRACK_MFEE':                    'broker_fee',
    'OPERATION_TYPE_TRACK_PFEE':                    'broker_fee',
    'OPERATION_TYPE_CASH_FEE':                      'broker_fee',
    'OPERATION_TYPE_OUT_FEE':                       'broker_fee',
    'OPERATION_TYPE_OUT_STAMP_DUTY':                'broker_fee',
    'OPERATION_TYPE_WRITING_OFF_VARMARGIN':         'broker_fee',  # списание вариационной маржи
    # Securities in/out (no cash impact)
    'OPERATION_TYPE_INPUT_SECURITIES':              'unknown',
    'OPERATION_TYPE_OUTPUT_SECURITIES':             'unknown',
    'OPERATION_TYPE_OVERNIGHT':                     'unknown',
    'OPERATION_TYPE_EXTERNAL_CSE':                  'unknown',
    'OPERATION_TYPE_COM_LIMIT_DELETE':              'unknown',
    'OPERATION_TYPE_COM_LIMIT_EXECUTE':             'unknown',
}


# ---------------------------------------------------------------------------
# REST client
# ---------------------------------------------------------------------------

class TinkoffRestClient:
    """Minimal async REST client for Tinkoff Invest API (gRPC-gateway)."""

    def __init__(self, token: str):
        self._headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    async def _post(self, path: str, body: dict) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f'{TINKOFF_REST_URL}/{path}',
                headers=self._headers,
                json=body,
            )

        if not resp.is_success:
            try:
                err = resp.json()
                msg = err.get('message') or err.get('detail') or resp.text
                code = int(err.get('code', 0))
            except Exception:
                msg = resp.text
                code = 0

            # gRPC status 16 = UNAUTHENTICATED
            if resp.status_code in (401, 403) or code == 16:
                raise PermissionError(f'UNAUTHENTICATED: {msg}')
            # gRPC status 7 = PERMISSION_DENIED
            if code == 7:
                raise PermissionError(f'PERMISSION_DENIED: {msg}')
            raise RuntimeError(f'Tinkoff API {resp.status_code}: {msg}')

        return resp.json()

    async def get_accounts(self) -> list[dict]:
        data = await self._post(
            'tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts',
            {},
        )
        return data.get('accounts', [])

    async def get_instrument_by(
        self,
        instrument_id: str,
        id_type: str,
        class_code: Optional[str] = None,
    ) -> dict:
        body: dict[str, Any] = {
            'idType': id_type,
            'id': instrument_id,
        }
        if class_code:
            body['classCode'] = class_code
        data = await self._post(
            'tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy',
            body,
        )
        instrument = data.get('instrument')
        return instrument if isinstance(instrument, dict) else data

    async def get_operations(
        self,
        account_id: str,
        since: datetime,
        to: datetime,
    ) -> list[dict]:
        """Fetch all executed operations using cursor-based pagination."""
        all_items: list[dict] = []
        cursor: str = ''

        while True:
            body: dict[str, Any] = {
                'accountId': account_id,
                'from': since.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'to': to.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'state': 'OPERATION_STATE_EXECUTED',
                'limit': 1000,
            }
            if cursor:
                body['cursor'] = cursor

            data = await self._post(
                'tinkoff.public.invest.api.contract.v1.OperationsService/GetOperationsByCursor',
                body,
            )

            items = data.get('items', [])
            all_items.extend(items)

            if not data.get('hasNext') or not items:
                break
            cursor = data.get('nextCursor', '')
            if not cursor:
                break

        return _dedupe_synthetic_operations(_sort_operations_chronologically(all_items))

    async def get_positions(self, account_id: str) -> dict:
        return await self._post(
            'tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions',
            {'accountId': account_id},
        )

    async def get_last_prices(self, instrument_ids: list[str]) -> list[dict]:
        if not instrument_ids:
            return []
        data = await self._post(
            'tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices',
            {
                'instrumentId': instrument_ids,
                'instrumentStatus': 'INSTRUMENT_STATUS_ALL',
            },
        )
        prices = data.get('lastPrices')
        if isinstance(prices, list):
            return prices
        prices = data.get('last_prices')
        return prices if isinstance(prices, list) else []

    async def get_portfolio(self, account_id: str, currency: str = 'RUB') -> dict:
        return await self._post(
            'tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio',
            {
                'accountId': account_id,
                'currency': currency,
            },
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _money_value_to_decimal(mv: dict) -> Decimal:
    """Convert Tinkoff MoneyValue dict (REST) → Decimal.
    units is int64 serialised as string in JSON; nano is int.
    """
    units = int(mv.get('units') or 0)
    nano  = int(mv.get('nano')  or 0)
    return Decimal(units) + Decimal(nano) / Decimal('1000000000')


def _api_number_to_decimal(value: Any) -> Decimal:
    """Convert scalar/Quotation-like API values to Decimal."""
    if value in (None, ''):
        return Decimal('0')

    if isinstance(value, dict):
        if 'units' in value or 'nano' in value:
            return _money_value_to_decimal(value)
        if 'value' in value:
            return Decimal(str(value.get('value') or 0))

    return Decimal(str(value))


def _normalize_metadata_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value

    if isinstance(value, list):
        merged: dict[str, Any] = {}
        for item in value:
            merged.update(_normalize_metadata_object(item))
        return merged

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return _normalize_metadata_object(parsed)

    return {}


def _best_tinkoff_instrument_id(meta: dict[str, Any]) -> Optional[tuple[str, str]]:
    instrument_uid = str(meta.get('instrument_uid', '')).strip()
    if instrument_uid:
        return ('INSTRUMENT_ID_TYPE_UID', instrument_uid)

    figi = str(meta.get('figi', '')).strip()
    if figi:
        return ('INSTRUMENT_ID_TYPE_FIGI', figi)

    ticker = str(meta.get('ticker', '')).strip()
    class_code = str(meta.get('class_code', '')).strip()
    if ticker and class_code:
        return ('INSTRUMENT_ID_TYPE_TICKER', f'{ticker}_{class_code}')

    return None


def _looks_like_bond_board(class_code: str, exchange: str = '') -> bool:
    normalized_class_code = class_code.upper().strip()
    normalized_exchange = exchange.upper().strip()

    if normalized_class_code.startswith('TQO'):
        return True

    if normalized_class_code in {'TQCB'}:
        return True

    return 'BOND' in normalized_exchange


def _is_bond_position(*metas: Any) -> bool:
    for meta in metas:
        if not isinstance(meta, dict):
            continue

        if str(meta.get('security_kind', '')).lower().strip() == 'bond':
            return True

        if str(meta.get('moex_market', '')).lower().strip() == 'bonds':
            return True

        if 'bond' in str(meta.get('instrument_type', '')).lower().strip():
            return True

        if _looks_like_bond_board(
            str(meta.get('class_code', '')),
            str(meta.get('exchange', '')),
        ):
            return True

    return False


def _match_position_id_from_rows(
    instrument_meta: dict[str, Any],
    position_rows: list[dict[str, Any]],
    used_position_ids: set[int],
) -> Optional[dict[str, Any]]:
    candidates = [
        ('position_uid', instrument_meta.get('position_uid')),
        ('instrument_uid', instrument_meta.get('instrument_uid')),
        ('asset_uid', instrument_meta.get('asset_uid')),
        ('figi', instrument_meta.get('figi')),
    ]

    for metadata_key, metadata_value in candidates:
        if not metadata_value:
            continue
        for row in position_rows:
            if row['position_id'] in used_position_ids:
                continue
            if str(row['metadata'].get(metadata_key, '')).strip() == str(metadata_value).strip():
                return row

    ticker = str(instrument_meta.get('ticker', '')).strip()
    class_code = str(instrument_meta.get('class_code', '')).strip()
    if ticker and class_code:
        for row in position_rows:
            if row['position_id'] in used_position_ids:
                continue
            if (
                str(row['metadata'].get('ticker', '')).strip() == ticker
                and str(row['metadata'].get('class_code', '')).strip() == class_code
            ):
                return row

    title = str(instrument_meta.get('name', '')).strip()
    if title:
        for row in position_rows:
            if row['position_id'] in used_position_ids:
                continue
            if str(row['title']).strip() == title:
                return row

    return None


def _op_field(op: dict, *names: str) -> str:
    for name in names:
        value = op.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def _op_datetime(op: dict) -> datetime:
    raw = op.get('date', '')
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def _op_date(op: dict) -> date:
    return _op_datetime(op).date()


def _sort_operations_chronologically(ops: list[dict]) -> list[dict]:
    # Historical import must apply cash movements before trades that spend them.
    # Tinkoff response order is not guaranteed for our business logic. In some
    # products (for example Invest Box) the real INPUT can land a few seconds
    # after the corresponding BUY, so inside a tight 10-second bucket we prefer
    # cash inflows before cash outflows.
    def sort_key(op: dict) -> tuple[int, int, datetime, str]:
        op_dt = _op_datetime(op)
        try:
            time_bucket = int(op_dt.timestamp()) // 10
        except Exception:
            time_bucket = -1

        kind = _map_operation(op)['kind']
        if kind == 'input':
            priority = 0
        elif kind in ('dividend', 'coupon', 'sell', 'bond_repayment', 'bond_repayment_full'):
            priority = 1
        elif kind == 'buy':
            priority = 2
        elif kind in ('broker_fee', 'tax'):
            priority = 3
        elif kind == 'output':
            priority = 4
        else:
            priority = 5

        return (time_bucket, priority, op_dt, str(op.get('id', '')))

    return sorted(ops, key=sort_key)


def _is_synthetic_ees_operation(op: dict) -> bool:
    return _op_field(op, 'classCode', 'class_code').upper().startswith('EES_')


def _operation_dedupe_key(op: dict) -> tuple[str, str, str, str, str, str]:
    op_dt_second = _op_datetime(op).replace(microsecond=0).isoformat()
    payment = op.get('payment') or {}
    payment_amount = str(_money_value_to_decimal(payment))
    quantity = str(op.get('quantity') or '')
    return (
        op_dt_second,
        op.get('type') or op.get('operationType', ''),
        _op_field(op, 'instrumentUid', 'instrument_uid'),
        _op_field(op, 'positionUid', 'position_uid'),
        _op_field(op, 'figi'),
        f'{payment_amount}:{quantity}',
    )


def _dedupe_synthetic_operations(ops: list[dict]) -> list[dict]:
    deduped: list[dict] = []

    for op in ops:
        if deduped and _operation_dedupe_key(deduped[-1]) == _operation_dedupe_key(op):
            prev = deduped[-1]
            prev_is_synthetic = _is_synthetic_ees_operation(prev)
            current_is_synthetic = _is_synthetic_ees_operation(op)

            if prev_is_synthetic and not current_is_synthetic:
                deduped[-1] = op
                continue

            if current_is_synthetic and not prev_is_synthetic:
                continue

        deduped.append(op)

    return deduped


def _op_currency(op: dict) -> str:
    """Extract currency: top-level field first, then payment.currency."""
    currency = (op.get('currency') or '').upper().strip()
    if not currency:
        payment = op.get('payment') or {}
        currency = (payment.get('currency') or '').upper().strip()
    return currency


def _normalize_lookup_token(value: str) -> str:
    normalized = value.upper().strip()
    normalized = normalized.replace('ИКС', 'X')
    return re.sub(r'[^A-Z0-9]+', '', normalized)


def _money_values_to_balance_map(items: Any) -> dict[str, Decimal]:
    balances: dict[str, Decimal] = {}
    if not isinstance(items, list):
        return balances

    for item in items:
        if not isinstance(item, dict):
            continue
        currency = str(item.get('currency') or '').upper().strip()
        if not currency:
            continue
        balances[currency] = balances.get(currency, Decimal('0')) + _money_value_to_decimal(item)

    return balances


def _extract_bond_trade_components(
    op: dict,
    total_amount: Decimal,
    quantity: Optional[Decimal],
) -> tuple[Decimal, Decimal]:
    if quantity is None or quantity <= 0:
        return total_amount, Decimal('0')

    clean_unit_price = _money_value_to_decimal(op.get('price', {}))
    accrued_interest = abs(_money_value_to_decimal(op.get('accruedInt', {}) or {}))
    clean_amount = abs(clean_unit_price * quantity) if clean_unit_price > 0 else Decimal('0')

    if clean_amount <= 0 and accrued_interest > 0 and total_amount > accrued_interest:
        clean_amount = total_amount - accrued_interest

    if clean_amount <= 0:
        clean_amount = total_amount

    return clean_amount, accrued_interest


def _infer_moex_market(class_code: str, exchange: str) -> Optional[str]:
    normalized_class_code = class_code.upper().strip()
    normalized_exchange = exchange.upper().strip()

    if _looks_like_bond_board(normalized_class_code, normalized_exchange):
        return 'bonds'

    if normalized_class_code in {'TQBR', 'TQTF', 'TQIF', 'TQPI', 'TQTD'}:
        return 'shares'

    if 'MOEX' in normalized_exchange and normalized_class_code:
        return 'shares'

    return None


def _infer_security_kind(instrument_type: str, class_code: str) -> str:
    normalized_type = instrument_type.lower().strip()
    normalized_class_code = class_code.upper().strip()

    if _looks_like_bond_board(normalized_class_code) or 'bond' in normalized_type:
        return 'bond'

    if any(token in normalized_type for token in ('etf', 'fund', 'share_type_etf', 'share_type_bpif')):
        return 'fund'

    return 'stock'


def _operation_instrument_cache_key(op: dict) -> str:
    return _op_field(op, 'positionUid', 'position_uid', 'instrumentUid', 'instrument_uid', 'figi')


def _normalize_instrument_meta(op: dict, raw: Optional[dict] = None) -> dict:
    raw = raw or {}
    brand_raw = raw.get('brand') if isinstance(raw.get('brand'), dict) else {}

    figi = _op_field(raw, 'figi') or _op_field(op, 'figi')
    instrument_uid = _op_field(raw, 'uid', 'instrumentUid', 'instrument_uid') or _op_field(op, 'instrumentUid', 'instrument_uid')
    position_uid = _op_field(raw, 'positionUid', 'position_uid') or _op_field(op, 'positionUid', 'position_uid')
    asset_uid = _op_field(raw, 'assetUid', 'asset_uid') or _op_field(op, 'assetUid', 'asset_uid')
    ticker = (_op_field(raw, 'ticker') or _op_field(op, 'ticker')).upper()
    class_code = (_op_field(raw, 'classCode', 'class_code') or _op_field(op, 'classCode', 'class_code')).upper()
    exchange = _op_field(raw, 'exchange', 'realExchange', 'real_exchange')
    instrument_type = _op_field(raw, 'instrumentType', 'instrument_type', 'instrumentKind', 'instrument_kind')
    name = _op_field(raw, 'name', 'shortName', 'short_name')
    logo_name = _op_field(brand_raw, 'logoName', 'logo_name') or _op_field(raw, 'logoName', 'logo_name')

    if not name:
        name = ticker or figi or position_uid or instrument_uid

    moex_market = _infer_moex_market(class_code, exchange)
    security_kind = _infer_security_kind(instrument_type, class_code)

    return {
        'figi': figi,
        'instrument_uid': instrument_uid,
        'position_uid': position_uid,
        'asset_uid': asset_uid,
        'ticker': ticker,
        'class_code': class_code,
        'exchange': exchange,
        'instrument_type': instrument_type.lower(),
        'name': name,
        'logo_name': logo_name,
        'moex_market': moex_market,
        'security_kind': security_kind,
    }


def _is_placeholder_instrument_name(name: str, meta: dict[str, Any]) -> bool:
    normalized_name = str(name or '').strip()
    if not normalized_name:
        return True

    normalized_upper = normalized_name.upper()
    candidates = {
        str(meta.get('ticker') or '').strip().upper(),
        str(meta.get('figi') or '').strip().upper(),
        str(meta.get('position_uid') or '').strip().upper(),
        str(meta.get('instrument_uid') or '').strip().upper(),
        str(meta.get('asset_uid') or '').strip().upper(),
    }
    candidates.discard('')
    return normalized_upper in candidates


async def _resolve_bond_nominal(
    client: TinkoffRestClient,
    bond_nominals: dict[str, Decimal],
    *metas: Any,
) -> Decimal:
    nominal_identifier: Optional[tuple[str, str]] = None

    for meta in metas:
        if not isinstance(meta, dict):
            continue
        nominal_identifier = _best_tinkoff_instrument_id(meta)
        if nominal_identifier is not None:
            break

    if nominal_identifier is None:
        return Decimal('0')

    nominal_key = nominal_identifier[1]
    nominal = bond_nominals.get(nominal_key, Decimal('0'))
    if nominal > 0:
        return nominal

    try:
        raw_instrument = await client.get_instrument_by(nominal_identifier[1], nominal_identifier[0])
    except Exception as exc:
        logger.warning(
            'Failed to load bond nominal for %s via %s: %s',
            nominal_identifier[1],
            nominal_identifier[0],
            exc,
        )
        return Decimal('0')

    nominal = _api_number_to_decimal(raw_instrument.get('nominal'))
    if nominal > 0:
        bond_nominals[nominal_key] = nominal
    return nominal


async def _build_live_price_payload(
    client: TinkoffRestClient,
    bond_nominals: dict[str, Decimal],
    matched_row: dict[str, Any],
    instrument_meta: dict[str, Any],
    quoted_price: Decimal,
    quantity: Decimal,
    *,
    current_nkd: Decimal = Decimal('0'),
    quoted_price_is_percent_of_nominal: bool = False,
    source: str = 'tinkoff',
) -> Optional[dict[str, Any]]:
    if quantity <= 0 or quoted_price < 0:
        return None

    meta = matched_row['metadata']
    per_unit_price = quoted_price
    clean_per_unit_price = quoted_price

    if _is_bond_position(instrument_meta, meta):
        if quoted_price_is_percent_of_nominal:
            nominal = await _resolve_bond_nominal(client, bond_nominals, instrument_meta, meta)
            if nominal <= 0:
                return None
            clean_per_unit_price = quoted_price / Decimal('100') * nominal
            per_unit_price = clean_per_unit_price + current_nkd
        else:
            # GetPortfolio already returns the bond price in account currency.
            clean_per_unit_price = quoted_price
            per_unit_price = quoted_price + current_nkd

    current_value = per_unit_price * quantity
    return {
        'position_id': matched_row['position_id'],
        'price': float(per_unit_price),
        'clean_price': float(clean_per_unit_price),
        'currency_code': matched_row['currency_code'],
        'current_value': float(current_value),
        'clean_current_value': float(clean_per_unit_price * quantity),
        'source': source,
    }


async def _refresh_position_metadata(
    conn: asyncpg.Connection,
    position_id: int,
    instrument_meta: dict[str, Any],
) -> None:
    metadata_patch = {
        key: value
        for key, value in {
            'figi': instrument_meta.get('figi', ''),
            'instrument_uid': instrument_meta.get('instrument_uid', ''),
            'position_uid': instrument_meta.get('position_uid', ''),
            'asset_uid': instrument_meta.get('asset_uid', ''),
            'ticker': instrument_meta.get('ticker', ''),
            'class_code': instrument_meta.get('class_code', ''),
            'exchange': instrument_meta.get('exchange', ''),
            'logo_name': instrument_meta.get('logo_name', ''),
            'security_kind': instrument_meta.get('security_kind', ''),
            'moex_market': instrument_meta.get('moex_market', ''),
            'import_source': 'tinkoff',
        }.items()
        if isinstance(value, str) and value
    }
    next_title = str(instrument_meta.get('name') or '').strip()

    if next_title and not _is_placeholder_instrument_name(next_title, instrument_meta):
        await conn.execute(
            '''UPDATE budgeting.portfolio_positions
               SET title = $2,
                   metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
               WHERE id = $1''',
            position_id,
            next_title,
            metadata_patch,
        )
        return

    if metadata_patch:
        await conn.execute(
            '''UPDATE budgeting.portfolio_positions
               SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
               WHERE id = $1''',
            position_id,
            metadata_patch,
        )


async def _enrich_instrument_meta(
    client: TinkoffRestClient,
    instrument_meta: dict[str, Any],
) -> dict[str, Any]:
    if (
        instrument_meta.get('logo_name')
        and not _is_placeholder_instrument_name(str(instrument_meta.get('name') or ''), instrument_meta)
    ):
        return instrument_meta

    resolution_attempts = [
        ('INSTRUMENT_ID_TYPE_POSITION_UID', str(instrument_meta.get('position_uid') or '').strip()),
        ('INSTRUMENT_ID_TYPE_UID', str(instrument_meta.get('instrument_uid') or '').strip()),
        ('INSTRUMENT_ID_TYPE_FIGI', str(instrument_meta.get('figi') or '').strip()),
    ]

    for id_type, instrument_id in resolution_attempts:
        if not instrument_id:
            continue
        try:
            raw_instrument = await client.get_instrument_by(instrument_id, id_type)
        except Exception:
            continue
        return _normalize_instrument_meta(instrument_meta, raw_instrument)

    return instrument_meta


async def _apply_bond_cost_metadata_delta(
    conn: asyncpg.Connection,
    position_id: int,
    clean_amount_delta: Decimal,
    accrued_interest_delta: Decimal,
) -> None:
    if clean_amount_delta <= 0 and accrued_interest_delta <= 0:
        return

    row = await conn.fetchrow(
        '''SELECT
               (metadata ->> 'clean_amount_in_base')::numeric AS clean_amount_in_base,
               (metadata ->> 'accrued_interest_paid_in_base')::numeric AS accrued_interest_paid_in_base
           FROM budgeting.portfolio_positions
           WHERE id = $1''',
        position_id,
    )
    if row is None:
        return

    current_clean_amount_in_base = Decimal(str(row['clean_amount_in_base'] or 0))
    current_accrued_interest_paid = Decimal(str(row['accrued_interest_paid_in_base'] or 0))

    await conn.execute(
        '''UPDATE budgeting.portfolio_positions
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'clean_amount_in_base', $2::numeric,
               'accrued_interest_paid_in_base', $3::numeric
           )
           WHERE id = $1''',
        position_id,
        current_clean_amount_in_base + round(clean_amount_delta, 2),
        current_accrued_interest_paid + round(accrued_interest_delta, 2),
    )


def _money_value_currency(mv: Any) -> str:
    if not isinstance(mv, dict):
        return ''
    currency = mv.get('currency')
    if not isinstance(currency, str):
        return ''
    return currency.upper().strip()


def _find_matching_portfolio_position(
    instrument_meta: dict[str, Any],
    portfolio_positions: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    for metadata_key, raw_names in (
        ('position_uid', ('positionUid', 'position_uid')),
        ('instrument_uid', ('instrumentUid', 'instrument_uid', 'uid')),
        ('figi', ('figi',)),
    ):
        metadata_value = str(instrument_meta.get(metadata_key) or '').strip()
        if not metadata_value:
            continue
        for portfolio_position in portfolio_positions:
            for raw_name in raw_names:
                raw_value = str(portfolio_position.get(raw_name) or '').strip()
                if raw_value and raw_value == metadata_value:
                    return portfolio_position

    ticker = str(instrument_meta.get('ticker') or '').strip()
    class_code = str(instrument_meta.get('class_code') or '').strip()
    if ticker and class_code:
        for portfolio_position in portfolio_positions:
            if (
                str(portfolio_position.get('ticker') or '').strip() == ticker
                and str(portfolio_position.get('classCode') or portfolio_position.get('class_code') or '').strip() == class_code
            ):
                return portfolio_position

    return None


async def _recover_missing_current_position(
    conn: asyncpg.Connection,
    user_id: int,
    owner_type: str,
    owner_user_id: Optional[int],
    owner_family_id: Optional[int],
    linked_account_id: int,
    instrument_meta: dict[str, Any],
    portfolio_position: dict[str, Any],
    quantity: Decimal,
) -> Optional[int]:
    average_price = _api_number_to_decimal(
        portfolio_position.get('averagePositionPrice') or portfolio_position.get('average_position_price'),
    )
    if average_price <= 0:
        average_price = _api_number_to_decimal(
            portfolio_position.get('currentPrice') or portfolio_position.get('current_price'),
        )

    currency = _money_value_currency(
        portfolio_position.get('averagePositionPrice') or portfolio_position.get('average_position_price'),
    ) or _money_value_currency(
        portfolio_position.get('currentPrice') or portfolio_position.get('current_price'),
    )

    if quantity <= 0 or average_price <= 0 or not currency:
        return None

    amount_in_currency = round(average_price * quantity, 8)
    if amount_in_currency <= 0:
        return None

    title = str(instrument_meta.get('name') or instrument_meta.get('ticker') or instrument_meta.get('figi') or 'Tinkoff position').strip()
    metadata: dict[str, Any] = {
        key: value
        for key, value in {
            'figi': instrument_meta.get('figi', ''),
            'instrument_uid': instrument_meta.get('instrument_uid', ''),
            'position_uid': instrument_meta.get('position_uid', ''),
            'asset_uid': instrument_meta.get('asset_uid', ''),
            'ticker': instrument_meta.get('ticker', ''),
            'class_code': instrument_meta.get('class_code', ''),
            'exchange': instrument_meta.get('exchange', ''),
            'logo_name': instrument_meta.get('logo_name', ''),
            'security_kind': instrument_meta.get('security_kind', ''),
            'moex_market': instrument_meta.get('moex_market', ''),
            'import_source': 'tinkoff',
            'recovery_source': 'current_portfolio',
        }.items()
        if value
    }

    base_currency = await conn.fetchval(
        'SELECT budgeting.get__owner_base_currency($1::text, $2::bigint, $3::bigint)',
        owner_type,
        owner_user_id,
        owner_family_id,
    )
    if str(base_currency or '').upper() == currency.upper():
        metadata['amount_in_base'] = float(round(amount_in_currency, 2))
        if _is_bond_position(instrument_meta, metadata):
            metadata['clean_amount_in_base'] = float(round(amount_in_currency, 2))

    position_id = await conn.fetchval(
        '''INSERT INTO budgeting.portfolio_positions (
               owner_type,
               owner_user_id,
               owner_family_id,
               investment_account_id,
               asset_type_code,
               title,
               status,
               quantity,
               amount_in_currency,
               currency_code,
               opened_at,
               comment,
               metadata,
               created_by_user_id
           )
           VALUES (
               $1::varchar,
               $2::bigint,
               $3::bigint,
               $4::bigint,
               'security',
               $5::varchar,
               'open',
               $6::numeric,
               $7::numeric,
               $8::char(3),
               CURRENT_DATE,
               $9::text,
               $10::jsonb,
               $11::bigint
           )
           RETURNING id''',
        owner_type,
        owner_user_id,
        owner_family_id,
        linked_account_id,
        title,
        quantity,
        amount_in_currency,
        currency,
        'Tinkoff: позиция восстановлена по текущему портфелю',
        metadata,
        user_id,
    )

    await conn.execute(
        '''INSERT INTO budgeting.portfolio_events (
               position_id,
               event_type,
               event_at,
               quantity,
               amount,
               currency_code,
               comment,
               metadata,
               created_by_user_id
           )
           VALUES (
               $1::bigint,
               'open',
               CURRENT_DATE,
               $2::numeric,
               $3::numeric,
               $4::char(3),
               $5::text,
               $6::jsonb,
               $7::bigint
           )''',
        position_id,
        quantity,
        amount_in_currency,
        currency,
        'Tinkoff: позиция восстановлена по текущему портфелю',
        {'action': 'recovered_current_position', 'import_source': 'tinkoff'},
        user_id,
    )

    return position_id


async def _backfill_bond_clean_amount_from_portfolio(
    conn: asyncpg.Connection,
    position_id: int,
    instrument_meta: dict[str, Any],
    portfolio_position: Optional[dict[str, Any]],
) -> None:
    if portfolio_position is None or not _is_bond_position(instrument_meta):
        return

    average_price = _api_number_to_decimal(
        portfolio_position.get('averagePositionPrice') or portfolio_position.get('average_position_price'),
    )
    quantity = _api_number_to_decimal(
        portfolio_position.get('quantity') or portfolio_position.get('quantityLots') or portfolio_position.get('quantity_lots'),
    )
    currency = _money_value_currency(
        portfolio_position.get('averagePositionPrice') or portfolio_position.get('average_position_price'),
    )

    if average_price <= 0 or quantity <= 0 or currency != 'RUB':
        return

    clean_amount_in_base = round(average_price * quantity, 2)
    await conn.execute(
        """UPDATE budgeting.portfolio_positions
           SET metadata = COALESCE(metadata, '{}'::jsonb)
                          || jsonb_build_object('clean_amount_in_base', $2::numeric)
           WHERE id = $1
             AND COALESCE(metadata ->> 'clean_amount_in_base', '') = ''""",
        position_id,
        clean_amount_in_base,
    )


def _portfolio_position_quantity(portfolio_position: dict[str, Any]) -> Decimal:
    return _api_number_to_decimal(
        portfolio_position.get('quantity')
        or portfolio_position.get('quantityLots')
        or portfolio_position.get('quantity_lots'),
    )


async def _record_unmatched_cash_only(
    conn: asyncpg.Connection,
    user_id: int,
    owner_type: str,
    owner_user_id: Optional[int],
    owner_family_id: Optional[int],
    linked_account_id: int,
    signed_amount: Decimal,
    currency: str,
    external_id: str,
    comment: str,
    operation_type: str,
) -> None:
    base_currency = await conn.fetchval(
        'SELECT budgeting.get__owner_base_currency($1::text, $2::bigint, $3::bigint)',
        owner_type,
        owner_user_id,
        owner_family_id,
    )
    normalized_base_currency = str(base_currency or '').upper()
    normalized_currency = currency.upper()
    signed_cost_in_base = round(signed_amount, 2)
    fx_consumptions: list[tuple[int, Decimal, Decimal]] = []

    if normalized_base_currency != normalized_currency:
        abs_amount = abs(signed_amount)
        if signed_amount > 0:
            signed_cost_in_base = round(signed_amount, 2)
        else:
            balance_row = await conn.fetchrow(
                '''SELECT COALESCE(amount, 0) AS amount
                   FROM budgeting.current_bank_balances
                   WHERE bank_account_id = $1 AND currency_code = $2''',
                linked_account_id,
                normalized_currency,
            )
            current_balance = Decimal(str(balance_row['amount'])) if balance_row else Decimal('0')
            if current_balance < abs_amount:
                raise ValueError(
                    f'Cannot record unmatched Tinkoff cash outflow of {abs_amount} {normalized_currency}: '
                    'insufficient balance on investment account'
                )

            remaining_to_consume = abs_amount
            consumed_cost_base = Decimal('0')
            lot_rows = await conn.fetch(
                '''SELECT id, amount_remaining, cost_base_remaining
                   FROM budgeting.fx_lots
                   WHERE bank_account_id = $1
                     AND currency_code = $2
                     AND amount_remaining > 0
                   ORDER BY created_at, id''',
                linked_account_id,
                normalized_currency,
            )

            for lot_row in lot_rows:
                if remaining_to_consume <= 0:
                    break

                lot_amount_remaining = Decimal(str(lot_row['amount_remaining']))
                lot_cost_remaining = Decimal(str(lot_row['cost_base_remaining']))
                consume_amount = min(remaining_to_consume, lot_amount_remaining)
                if consume_amount == lot_amount_remaining:
                    consume_cost = lot_cost_remaining
                else:
                    consume_cost = round(lot_cost_remaining * consume_amount / lot_amount_remaining, 2)

                fx_consumptions.append((int(lot_row['id']), consume_amount, consume_cost))
                consumed_cost_base += consume_cost
                remaining_to_consume -= consume_amount

            if remaining_to_consume > 0:
                # Historical FX rates are unavailable from T-Bank cash-only movements,
                # so the uncovered remainder falls back to the same 1:1 base-cost rule
                # that we already use for imported broker inputs.
                consumed_cost_base += round(remaining_to_consume, 2)

            signed_cost_in_base = -consumed_cost_base

    operation_id = await conn.fetchval(
        '''INSERT INTO budgeting.operations (
               actor_user_id,
               owner_type,
               owner_user_id,
               owner_family_id,
               type,
               comment
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id''',
        user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        operation_type,
        comment,
    )

    await conn.execute(
        '''INSERT INTO budgeting.bank_entries (
               operation_id,
               bank_account_id,
               currency_code,
               amount,
               external_id,
               import_source
           )
           VALUES ($1, $2, $3, $4, $5, 'tinkoff')''',
        operation_id,
        linked_account_id,
        currency,
        signed_amount,
        external_id,
    )

    await conn.execute(
        'SELECT budgeting.put__apply_current_bank_delta($1::bigint, $2::char(3), $3::numeric, $4::numeric)',
        linked_account_id,
        currency,
        signed_amount,
        signed_cost_in_base,
    )

    if normalized_base_currency != normalized_currency:
        abs_amount = abs(signed_amount)
        if signed_amount > 0:
            positive_cost_in_base = round(abs_amount, 2)
            await conn.execute(
                '''INSERT INTO budgeting.fx_lots (
                       bank_account_id,
                       currency_code,
                       amount_initial,
                       amount_remaining,
                       buy_rate_in_base,
                       cost_base_initial,
                       cost_base_remaining,
                       opened_by_operation_id
                   )
                   VALUES ($1, $2, $3, $3, $4, $5, $5, $6)''',
                linked_account_id,
                normalized_currency,
                abs_amount,
                positive_cost_in_base / abs_amount,
                positive_cost_in_base,
                operation_id,
            )
        else:
            for lot_id, consume_amount, consume_cost in fx_consumptions:
                await conn.execute(
                    '''UPDATE budgeting.fx_lots
                       SET amount_remaining = amount_remaining - $2,
                           cost_base_remaining = cost_base_remaining - $3
                       WHERE id = $1''',
                    lot_id,
                    consume_amount,
                    consume_cost,
                )
                await conn.execute(
                    '''INSERT INTO budgeting.lot_consumptions (operation_id, lot_id, amount, cost_base)
                       VALUES ($1, $2, $3, $4)''',
                    operation_id,
                    lot_id,
                    consume_amount,
                    consume_cost,
                )


async def _record_position_principal_repayment(
    conn: asyncpg.Connection,
    user_id: int,
    position_id: int,
    return_amount_in_currency: Decimal,
    currency: str,
    principal_reduction_in_currency: Decimal,
    repaid_at: date,
    external_id: str,
    comment: str,
) -> None:
    row = await conn.fetchrow(
        '''SELECT
               owner_type,
               owner_user_id,
               owner_family_id,
               status,
               quantity,
               amount_in_currency,
               COALESCE((metadata ->> 'amount_in_base')::numeric, 0) AS amount_in_base,
               (metadata ->> 'clean_amount_in_base')::numeric AS clean_amount_in_base,
               COALESCE((metadata ->> 'returned_amount_in_base')::numeric, 0) AS returned_amount_in_base,
               investment_account_id,
               title
           FROM budgeting.portfolio_positions
           WHERE id = $1''',
        position_id,
    )
    if row is None:
        raise ValueError(f'Unknown portfolio position {position_id}')

    if row['status'] != 'open':
        raise ValueError(f'Portfolio position {position_id} must be open for bond repayment')

    current_amount_in_currency = Decimal(str(row['amount_in_currency'] or 0))
    current_amount_in_base = Decimal(str(row['amount_in_base'] or 0))
    current_clean_amount_in_base = (
        Decimal(str(row['clean_amount_in_base']))
        if row['clean_amount_in_base'] is not None
        else None
    )
    current_returned_amount_in_base = Decimal(str(row['returned_amount_in_base'] or 0))
    if principal_reduction_in_currency <= 0 or principal_reduction_in_currency >= current_amount_in_currency:
        raise ValueError(
            'Bond repayment must leave a positive remaining principal; use full repayment for final close'
        )

    owner_type = str(row['owner_type'])
    owner_user_id = row['owner_user_id']
    owner_family_id = row['owner_family_id']
    investment_account_id = int(row['investment_account_id'])
    title = str(row['title'] or '')

    base_currency = await conn.fetchval(
        'SELECT budgeting.get__owner_base_currency($1::text, $2::bigint, $3::bigint)',
        owner_type,
        owner_user_id,
        owner_family_id,
    )
    if str(base_currency or '').upper() != currency.upper():
        raise ValueError('Non-base currency bond repayment is not supported yet')

    effective_return_amount_in_base = round(return_amount_in_currency, 2)
    released_principal_in_base = round(
        current_amount_in_base * principal_reduction_in_currency / current_amount_in_currency,
        2,
    )
    remaining_amount_in_base = current_amount_in_base - released_principal_in_base
    remaining_clean_amount_in_base = None
    if current_clean_amount_in_base is not None:
        released_clean_principal_in_base = round(
            current_clean_amount_in_base * principal_reduction_in_currency / current_amount_in_currency,
            2,
        )
        remaining_clean_amount_in_base = current_clean_amount_in_base - released_clean_principal_in_base
    next_returned_amount_in_base = current_returned_amount_in_base + effective_return_amount_in_base

    operation_id = await conn.fetchval(
        '''INSERT INTO budgeting.operations (
               actor_user_id,
               owner_type,
               owner_user_id,
               owner_family_id,
               type,
               comment
           )
           VALUES ($1, $2, $3, $4, 'investment_adjustment', $5)
           RETURNING id''',
        user_id,
        owner_type,
        owner_user_id,
        owner_family_id,
        comment or f'Погашение облигации · {title}',
    )

    await conn.execute(
        '''INSERT INTO budgeting.bank_entries (
               operation_id,
               bank_account_id,
               currency_code,
               amount,
               external_id,
               import_source
           )
           VALUES ($1, $2, $3, $4, $5, 'tinkoff')''',
        operation_id,
        investment_account_id,
        currency,
        return_amount_in_currency,
        external_id,
    )

    await conn.execute(
        'SELECT budgeting.put__apply_current_bank_delta($1::bigint, $2::char(3), $3::numeric, $4::numeric)',
        investment_account_id,
        currency,
        return_amount_in_currency,
        released_principal_in_base,
    )

    await conn.execute(
        '''UPDATE budgeting.portfolio_positions
           SET amount_in_currency = amount_in_currency - $2::numeric,
               metadata = COALESCE(metadata, '{}'::jsonb)
                          || jsonb_build_object(
                              'amount_in_base', $3::numeric,
                              'returned_amount_in_base', $4::numeric
                          )
                          || CASE
                               WHEN $5::numeric IS NULL THEN '{}'::jsonb
                               ELSE jsonb_build_object('clean_amount_in_base', $5::numeric)
                             END
           WHERE id = $1''',
        position_id,
        principal_reduction_in_currency,
        remaining_amount_in_base,
        next_returned_amount_in_base,
        remaining_clean_amount_in_base,
    )

    await conn.execute(
        '''INSERT INTO budgeting.portfolio_events (
               position_id,
               event_type,
               event_at,
               amount,
               currency_code,
               linked_operation_id,
               comment,
               metadata,
               created_by_user_id
           )
           VALUES (
               $1::bigint,
               'adjustment',
               $2::date,
               $3::numeric,
               $4::char(3),
               $5::bigint,
               $6::text,
               jsonb_build_object(
                   'action', 'bond_repayment',
                   'amount_in_base', $7::numeric,
                   'principal_amount_in_currency', $8::numeric,
                   'principal_amount_in_base', $9::numeric
               ),
               $10::bigint
           )''',
        position_id,
        repaid_at,
        return_amount_in_currency,
        currency,
        operation_id,
        comment or f'Погашение облигации · {title}',
        effective_return_amount_in_base,
        principal_reduction_in_currency,
        released_principal_in_base,
        user_id,
    )


def _map_operation(op: dict) -> dict:
    # GetOperationsByCursor returns 'type'; GetOperations returns 'operationType'
    op_type = op.get('type') or op.get('operationType', '')
    kind = _OP_TYPE_MAP.get(op_type, 'unknown')
    return {
        'kind': kind,
        'figi': op.get('figi', ''),
    }


# ---------------------------------------------------------------------------
# TinkoffSync
# ---------------------------------------------------------------------------

class TinkoffSync:
    """
    Stateless helper: preview (dry-run) and apply (write) Tinkoff operations.
    """

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    # ── Helpers ─────────────────────────────────────────────────────────────

    async def _get_since(
        self,
        client: TinkoffRestClient,
        tinkoff_account_id: str,
        conn_row: Optional[dict] = None,
    ) -> datetime:
        """Return sync start datetime from settings or the broker account opened date."""
        settings = conn_row.get('settings') or {}
        if isinstance(settings, str):
            try:
                settings = json.loads(settings)
            except Exception:
                settings = {}
        sync_from = settings.get('sync_from')
        if sync_from:
            try:
                d = date.fromisoformat(sync_from)
                return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
            except Exception:
                pass

        try:
            accounts = await client.get_accounts()
        except Exception as exc:
            logger.warning(
                'Failed to load T-Bank accounts for sync start fallback on account %s: %s',
                tinkoff_account_id,
                exc,
            )
            accounts = []

        for account in accounts:
            if str(account.get('id', '')).strip() != str(tinkoff_account_id).strip():
                continue
            opened_raw = account.get('openedDate') or account.get('opened_date')
            if not opened_raw:
                break
            try:
                opened_at = datetime.fromisoformat(str(opened_raw).replace('Z', '+00:00'))
                return datetime(opened_at.year, opened_at.month, opened_at.day, tzinfo=timezone.utc)
            except Exception:
                break

        fallback = datetime.now(timezone.utc) - timedelta(days=10 * 365)
        return datetime(fallback.year, fallback.month, fallback.day, tzinfo=timezone.utc)

    async def _get_current_cash_balances(
        self,
        client: TinkoffRestClient,
        tinkoff_account_id: str,
    ) -> dict[str, Decimal]:
        positions = await client.get_positions(tinkoff_account_id)
        balances = _money_values_to_balance_map(positions.get('money'))
        blocked_balances = _money_values_to_balance_map(positions.get('blocked'))

        for currency, amount in blocked_balances.items():
            balances[currency] = balances.get(currency, Decimal('0')) + amount

        return balances

    async def _infer_opening_cash_seeds(
        self,
        client: TinkoffRestClient,
        tinkoff_account_id: str,
        raw_ops: list[dict],
    ) -> dict[str, Decimal]:
        current_balances = await self._get_current_cash_balances(client, tinkoff_account_id)
        history_balances: dict[str, Decimal] = {}

        for op in raw_ops:
            currency = _op_currency(op)
            if not currency:
                continue
            history_balances[currency] = history_balances.get(currency, Decimal('0')) + _money_value_to_decimal(
                op.get('payment', {})
            )

        seeds: dict[str, Decimal] = {}
        for currency in sorted(set(current_balances) | set(history_balances)):
            difference = current_balances.get(currency, Decimal('0')) - history_balances.get(currency, Decimal('0'))
            normalized_difference = round(difference, 2)
            if abs(normalized_difference) < Decimal('0.01'):
                continue
            if normalized_difference > 0:
                seeds[currency] = normalized_difference
                continue

            logger.warning(
                'T-Bank history cash exceeds current cash on account %s for %s by %s; '
                'negative opening balance seed was skipped',
                tinkoff_account_id,
                currency,
                abs(normalized_difference),
            )

        return seeds

    # ── Public API ──────────────────────────────────────────────────────────

    async def preview(
        self,
        token: str,
        tinkoff_account_id: str,
        linked_account_id: int,
        user_id: int,
        conn_row: Optional[dict] = None,
    ) -> dict:
        """Dry-run: classify operations without writing to DB."""
        client = TinkoffRestClient(token)
        since = await self._get_since(client, tinkoff_account_id, conn_row=conn_row)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))
        logger.info(
            'T-Bank preview fetched %s operations for account %s since %s',
            len(raw_ops),
            tinkoff_account_id,
            since.date().isoformat(),
        )
        already_imported_ids = await self._get_already_imported_ids(raw_ops)
        preview_auto_ops = [
            op for op in raw_ops
            if op.get('id') not in already_imported_ids
            and _map_operation(op)['kind'] not in ('input', 'output', 'unknown')
        ]
        # Preview should stay responsive, so we resolve metadata only for the
        # new auto-operations that are actually displayed to the user.
        instrument_map = await self._resolve_instrument_map(client, preview_auto_ops)
        logger.info(
            'T-Bank preview resolved metadata for %s unique instruments on account %s',
            len(instrument_map),
            tinkoff_account_id,
        )

        deposits:        list[dict] = []
        withdrawals:     list[dict] = []
        auto_operations: list[dict] = []

        for op in raw_ops:
            op_id    = op['id']
            already  = op_id in already_imported_ids
            mapped   = _map_operation(op)
            payment  = _money_value_to_decimal(op.get('payment', {}))
            currency = _op_currency(op)
            qty      = op.get('quantity')
            # Пропускаем операции без валюты — некорректные данные от API
            if not currency:
                continue

            if mapped['kind'] == 'input':
                deposits.append({
                    'tinkoff_op_id': op_id,
                    'amount': float(payment),
                    'currency_code': currency,
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })
            elif mapped['kind'] == 'output':
                withdrawals.append({
                    'tinkoff_op_id': op_id,
                    'amount': float(abs(payment)),
                    'currency_code': currency,
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })
            else:
                instrument_meta = self._get_instrument_meta(instrument_map, op)
                auto_operations.append({
                    'tinkoff_op_id': op_id,
                    'type': mapped['kind'],
                    'ticker': instrument_meta.get('ticker', ''),
                    'title': instrument_meta.get('name', ''),
                    'figi': instrument_meta.get('figi', mapped['figi']),
                    'logo_name': instrument_meta.get('logo_name', ''),
                    'amount': float(abs(payment)),
                    'quantity': float(qty) if qty else None,
                    'currency_code': currency,
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })

        all_items = deposits + withdrawals + auto_operations
        return {
            'deposits': deposits,
            'withdrawals': withdrawals,
            'auto_operations': auto_operations,
            'total_new': sum(1 for x in all_items if not x['already_imported']),
            'total_already_imported': sum(1 for x in all_items if x['already_imported']),
        }

    async def apply(
        self,
        connection_id: int,
        deposit_resolutions: list[dict],
        user_id: int,
    ) -> dict:
        """Apply synced operations in a single DB transaction."""
        conn_row = await self._get_connection(connection_id, user_id)
        creds = conn_row['credentials']
        if isinstance(creds, str):
            creds = json.loads(creds)
        token              = creds['token']
        tinkoff_account_id = conn_row['provider_account_id']
        linked_account_id  = conn_row['linked_account_id']
        owner_type         = conn_row['owner_type']
        owner_user_id      = conn_row['owner_user_id']
        owner_family_id    = conn_row['owner_family_id']

        client = TinkoffRestClient(token)
        since  = await self._get_since(client, tinkoff_account_id, conn_row=conn_row)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))
        logger.info(
            'T-Bank apply fetched %s operations for account %s since %s',
            len(raw_ops),
            tinkoff_account_id,
            since.date().isoformat(),
        )
        instrument_map = await self._resolve_instrument_map(client, raw_ops)
        logger.info(
            'T-Bank apply resolved metadata for %s unique instruments on account %s',
            len(instrument_map),
            tinkoff_account_id,
        )
        current_portfolio_positions: list[dict[str, Any]] = []
        try:
            portfolio = await client.get_portfolio(tinkoff_account_id, 'RUB')
            raw_positions = portfolio.get('positions', [])
            if isinstance(raw_positions, list):
                current_portfolio_positions = [item for item in raw_positions if isinstance(item, dict)]
        except Exception as exc:
            logger.warning(
                'Failed to preload T-Bank portfolio for sync apply on account %s: %s',
                tinkoff_account_id,
                exc,
            )

        already_imported_ids = await self._get_already_imported_ids(raw_ops)
        resolutions_map = {r['tinkoff_op_id']: r for r in deposit_resolutions}
        opening_cash_seeds = (
            await self._infer_opening_cash_seeds(client, tinkoff_account_id, raw_ops)
            if not already_imported_ids
            else {}
        )

        applied_count = 0
        skipped_count = 0
        reconciled_positions = 0

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                for currency, amount in opening_cash_seeds.items():
                    await _record_unmatched_cash_only(
                        conn,
                        user_id,
                        owner_type,
                        owner_user_id,
                        owner_family_id,
                        linked_account_id,
                        amount,
                        currency,
                        f'tinkoff-opening-seed:{tinkoff_account_id}:{currency}',
                        'Tinkoff: начальный остаток, отсутствующий в истории API',
                        'investment_adjustment',
                    )
                    logger.info(
                        'Recorded inferred opening T-Bank cash seed for account %s (%s %s)',
                        tinkoff_account_id,
                        amount,
                        currency,
                    )

                # Process ALL operations in chronological order (by date from Tinkoff API).
                # This ensures deposits are applied before the buys that spend the cash.
                for op in raw_ops:
                    op_id = op['id']

                    if op_id in already_imported_ids:
                        skipped_count += 1
                        continue

                    mapped = _map_operation(op)
                    payment = _money_value_to_decimal(op.get('payment', {}))
                    currency = _op_currency(op)
                    if not currency:
                        continue

                    # Deposit/withdrawal with manual resolution
                    if op_id in resolutions_map:
                        resolution = resolutions_map[op_id]
                        kind = resolution['resolution']
                        source_account_id = resolution.get('source_account_id')

                        await self._apply_deposit_resolution(
                            conn, user_id, owner_type, owner_user_id, owner_family_id,
                            linked_account_id, op_id, payment, currency, kind, source_account_id,
                        )
                        applied_count += 1
                        continue

                    if mapped['kind'] == 'output':
                        await _record_unmatched_cash_only(
                            conn,
                            user_id,
                            owner_type,
                            owner_user_id,
                            owner_family_id,
                            linked_account_id,
                            -abs(payment),
                            currency,
                            op_id,
                            'Tinkoff: вывод со счёта',
                            'investment_adjustment',
                        )
                        applied_count += 1
                        continue

                    # Skip unresolved deposits and unknown operations
                    if mapped['kind'] in ('input', 'unknown'):
                        continue

                    # Auto operations (buy, sell, dividend, fee, tax, etc.)
                    instrument_meta = self._get_instrument_meta(instrument_map, op)
                    await self._apply_auto_operation(
                        conn, user_id, linked_account_id, op, mapped, instrument_meta,
                        owner_type, owner_user_id, owner_family_id, current_portfolio_positions,
                    )
                    applied_count += 1

                reconciled_positions = await self._reconcile_current_quantities(
                    conn,
                    client,
                    tinkoff_account_id,
                    linked_account_id,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                )

                # Update last_synced_at
                await conn.execute(
                    'UPDATE budgeting.external_connections SET last_synced_at = now() WHERE id = $1',
                    connection_id,
                )

        return {
            'status': 'ok',
            'applied': applied_count,
            'skipped_already_imported': skipped_count,
            'reconciled_open_positions': reconciled_positions,
        }

    async def get_live_position_prices(self, user_id: int) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT
                       ec.id AS connection_id,
                       ec.provider_account_id,
                       ec.linked_account_id,
                       ec.credentials,
                       pp.id AS position_id,
                       pp.title,
                       pp.quantity,
                       pp.currency_code,
                       pp.metadata
                   FROM budgeting.external_connections ec
                   JOIN budgeting.portfolio_positions pp
                     ON pp.investment_account_id = ec.linked_account_id
                    AND pp.status = 'open'
                   WHERE ec.provider = 'tinkoff'
                     AND ec.is_active = true
                     AND ec.linked_account_id IS NOT NULL
                     AND (
                       (ec.owner_type = 'user' AND ec.owner_user_id = $1)
                       OR
                       (ec.owner_type = 'family' AND ec.owner_family_id = (
                           SELECT family_id FROM budgeting.family_members WHERE user_id = $1 LIMIT 1
                       ))
                     )
                   ORDER BY ec.id, pp.id''',
                user_id,
            )

        if not rows:
            return []

        grouped_rows: dict[int, list[dict[str, Any]]] = {}
        connection_info: dict[int, dict[str, Any]] = {}

        for row in rows:
            item = dict(row)
            connection_id = int(item['connection_id'])
            grouped_rows.setdefault(connection_id, []).append(item)
            if connection_id not in connection_info:
                connection_info[connection_id] = {
                    'provider_account_id': item['provider_account_id'],
                    'credentials': item['credentials'],
                }

        result: list[dict] = []

        for connection_id, position_rows in grouped_rows.items():
            info = connection_info[connection_id]
            creds = info['credentials']
            if isinstance(creds, str):
                try:
                    creds = json.loads(creds)
                except Exception:
                    creds = {}

            token = creds.get('token')
            provider_account_id = info.get('provider_account_id')
            if not token or not provider_account_id:
                continue

            client = TinkoffRestClient(token)
            normalized_position_rows: list[dict[str, Any]] = []

            for position in position_rows:
                meta = _normalize_metadata_object(position.get('metadata'))
                normalized_position_rows.append({
                    'position_id': int(position['position_id']),
                    'title': str(position.get('title') or ''),
                    'quantity': Decimal(str(position['quantity'])) if position.get('quantity') not in (None, '') else Decimal('0'),
                    'currency_code': position['currency_code'],
                    'metadata': meta,
                })

            if not normalized_position_rows:
                continue

            bond_nominals: dict[str, Decimal] = {}
            used_position_ids: set[int] = set()
            portfolio_positions: list[dict[str, Any]] = []

            try:
                portfolio = await client.get_portfolio(provider_account_id, 'RUB')
                raw_positions = portfolio.get('positions', [])
                if isinstance(raw_positions, list):
                    portfolio_positions = [item for item in raw_positions if isinstance(item, dict)]
                else:
                    logger.warning(
                        'T-Bank GetPortfolio returned invalid positions payload for connection %s account %s',
                        connection_id,
                        provider_account_id,
                    )
            except Exception as exc:
                logger.warning(
                    'T-Bank GetPortfolio failed for connection %s account %s: %s',
                    connection_id,
                    provider_account_id,
                    exc,
                )

            for portfolio_position in portfolio_positions:
                instrument_meta = _normalize_instrument_meta({}, portfolio_position)
                matched_row = _match_position_id_from_rows(
                    instrument_meta,
                    normalized_position_rows,
                    used_position_ids,
                )
                if matched_row is None:
                    continue

                quantity = _api_number_to_decimal(portfolio_position.get('quantity'))
                if quantity <= 0:
                    quantity = matched_row['quantity']
                if quantity <= 0:
                    continue

                quoted_price = _api_number_to_decimal(
                    portfolio_position.get('currentPrice') or portfolio_position.get('current_price'),
                )

                live_price = await _build_live_price_payload(
                    client,
                    bond_nominals,
                    matched_row,
                    instrument_meta,
                    quoted_price,
                    quantity,
                    current_nkd=_api_number_to_decimal(
                        portfolio_position.get('currentNkd') or portfolio_position.get('current_nkd'),
                    ),
                    quoted_price_is_percent_of_nominal=False,
                    source='tinkoff',
                )
                if live_price is None:
                    continue

                used_position_ids.add(matched_row['position_id'])
                result.append(live_price)

            unresolved_rows = [
                row for row in normalized_position_rows
                if row['position_id'] not in used_position_ids
            ]
            fallback_ids: list[str] = []

            for unresolved_row in unresolved_rows:
                identifier = _best_tinkoff_instrument_id(unresolved_row['metadata'])
                if identifier is None:
                    continue
                fallback_ids.append(identifier[1])

            if fallback_ids:
                try:
                    last_prices = await client.get_last_prices(list(dict.fromkeys(fallback_ids)))
                except Exception as exc:
                    logger.warning(
                        'T-Bank GetLastPrices failed for connection %s account %s: %s',
                        connection_id,
                        provider_account_id,
                        exc,
                    )
                    last_prices = []

                for last_price in last_prices:
                    if not isinstance(last_price, dict):
                        continue

                    instrument_meta = _normalize_instrument_meta({}, last_price)
                    matched_row = _match_position_id_from_rows(
                        instrument_meta,
                        normalized_position_rows,
                        used_position_ids,
                    )
                    if matched_row is None:
                        continue

                    live_price = await _build_live_price_payload(
                        client,
                        bond_nominals,
                        matched_row,
                        instrument_meta,
                        _api_number_to_decimal(
                            last_price.get('price')
                            or last_price.get('lastPrice')
                            or last_price.get('last_price'),
                        ),
                        matched_row['quantity'],
                        quoted_price_is_percent_of_nominal=True,
                        source='tinkoff',
                    )
                    if live_price is None:
                        continue

                    used_position_ids.add(matched_row['position_id'])
                    result.append(live_price)

            unresolved_labels = []
            for unresolved_row in normalized_position_rows:
                if unresolved_row['position_id'] in used_position_ids:
                    continue
                meta = unresolved_row['metadata']
                unresolved_labels.append(
                    f"{unresolved_row['position_id']}:{meta.get('ticker') or meta.get('figi') or unresolved_row['title']}"
                )

            if unresolved_labels:
                logger.warning(
                    'T-Bank live prices unresolved for connection %s account %s: %s',
                    connection_id,
                    provider_account_id,
                    ', '.join(unresolved_labels[:10]),
                )

        return result

    # ── DB helpers ───────────────────────────────────────────────────────────

    async def _get_connection(self, connection_id: int, user_id: int) -> dict:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                '''SELECT ec.*
                   FROM budgeting.external_connections ec
                   WHERE ec.id = $1
                     AND ec.is_active = true
                     AND (
                       (ec.owner_type = 'user'   AND ec.owner_user_id = $2)
                       OR
                       (ec.owner_type = 'family' AND ec.owner_family_id = (
                           SELECT family_id FROM budgeting.family_members WHERE user_id = $2 LIMIT 1
                       ))
                     )''',
                connection_id, user_id,
            )
        if row is None:
            raise ValueError(f'Connection {connection_id} not found or not accessible')
        return dict(row)

    async def _get_already_imported_ids(self, raw_ops: list[dict]) -> set[str]:
        if not raw_ops:
            return set()
        op_ids = [op['id'] for op in raw_ops]
        async with self._pool.acquire() as conn:
            pe_rows = await conn.fetch(
                '''SELECT external_id FROM budgeting.portfolio_events
                   WHERE import_source = 'tinkoff' AND external_id = ANY($1::text[])''',
                op_ids,
            )
            be_rows = await conn.fetch(
                '''SELECT external_id FROM budgeting.bank_entries
                   WHERE import_source = 'tinkoff' AND external_id = ANY($1::text[])''',
                op_ids,
            )
        return {r['external_id'] for r in pe_rows} | {r['external_id'] for r in be_rows}

    async def _resolve_instrument_map(
        self,
        client: TinkoffRestClient,
        raw_ops: list[dict],
    ) -> dict[str, dict]:
        unique_ops: dict[str, dict] = {}
        for op in raw_ops:
            cache_key = _operation_instrument_cache_key(op)
            if cache_key and cache_key not in unique_ops:
                unique_ops[cache_key] = op

        semaphore = asyncio.Semaphore(6)

        async def resolve_one(cache_key: str, op: dict) -> tuple[str, dict]:
            raw_instrument: Optional[dict] = None
            resolution_attempts = [
                ('INSTRUMENT_ID_TYPE_POSITION_UID', _op_field(op, 'positionUid', 'position_uid')),
                ('INSTRUMENT_ID_TYPE_UID', _op_field(op, 'instrumentUid', 'instrument_uid')),
                ('INSTRUMENT_ID_TYPE_FIGI', _op_field(op, 'figi')),
            ]

            async with semaphore:
                for id_type, instrument_id in resolution_attempts:
                    if not instrument_id:
                        continue
                    try:
                        raw_instrument = await client.get_instrument_by(instrument_id, id_type)
                        break
                    except Exception:
                        continue

            return cache_key, _normalize_instrument_meta(op, raw_instrument)

        if not unique_ops:
            return {}

        resolved_items = await asyncio.gather(
            *(resolve_one(cache_key, op) for cache_key, op in unique_ops.items())
        )
        return dict(resolved_items)

    def _get_instrument_meta(self, instrument_map: dict[str, dict], op: dict) -> dict:
        cache_key = _operation_instrument_cache_key(op)
        if cache_key and cache_key in instrument_map:
            return instrument_map[cache_key]
        return _normalize_instrument_meta(op)

    async def _find_position(
        self,
        conn: asyncpg.Connection,
        linked_account_id: int,
        instrument_meta: Optional[dict],
    ) -> Optional[int]:
        meta = instrument_meta or {}
        rows = await conn.fetch(
            '''SELECT id, title, metadata
               FROM budgeting.portfolio_positions
               WHERE investment_account_id = $1
                 AND status = 'open' ''',
            linked_account_id,
        )

        normalized_rows = [
            (row['id'], row['title'], _normalize_metadata_object(row['metadata']))
            for row in rows
        ]

        lookup_candidates = [
            ('position_uid', meta.get('position_uid')),
            ('instrument_uid', meta.get('instrument_uid')),
            ('asset_uid', meta.get('asset_uid')),
            ('figi', meta.get('figi')),
        ]

        for metadata_key, metadata_value in lookup_candidates:
            if not metadata_value:
                continue
            for position_id, _title, position_meta in normalized_rows:
                if str(position_meta.get(metadata_key, '')).strip() == str(metadata_value).strip():
                    return position_id

        ticker = meta.get('ticker')
        class_code = meta.get('class_code')
        if ticker and class_code:
            for position_id, _title, position_meta in normalized_rows:
                if (
                    str(position_meta.get('ticker', '')).strip() == str(ticker).strip()
                    and str(position_meta.get('class_code', '')).strip() == str(class_code).strip()
                ):
                    return position_id

        title = meta.get('name')
        if title:
            normalized_title = str(title).strip()
            for position_id, position_title, _position_meta in normalized_rows:
                if str(position_title).strip() == normalized_title:
                    return position_id

        ticker = str(meta.get('ticker') or '').strip()
        ticker_token = _normalize_lookup_token(ticker)
        if len(ticker_token) >= 2:
            ticker_candidates: list[int] = []
            for position_id, position_title, position_meta in normalized_rows:
                stored_ticker_token = _normalize_lookup_token(str(position_meta.get('ticker', '')))
                if ticker_token == stored_ticker_token:
                    ticker_candidates.append(position_id)
            if len(ticker_candidates) == 1:
                return ticker_candidates[0]

        return None

    async def _reconcile_current_quantities(
        self,
        conn: asyncpg.Connection,
        client: TinkoffRestClient,
        tinkoff_account_id: str,
        linked_account_id: int,
        user_id: int,
        owner_type: str,
        owner_user_id: Optional[int],
        owner_family_id: Optional[int],
    ) -> int:
        current_positions = await client.get_positions(tinkoff_account_id)
        securities = current_positions.get('securities', [])
        if not isinstance(securities, list):
            return 0

        portfolio_positions_raw: list[dict[str, Any]] = []
        try:
            portfolio = await client.get_portfolio(tinkoff_account_id, 'RUB')
            raw_positions = portfolio.get('positions', [])
            if isinstance(raw_positions, list):
                portfolio_positions_raw = [item for item in raw_positions if isinstance(item, dict)]
        except Exception as exc:
            logger.warning(
                'Failed to load T-Bank portfolio for quantity reconciliation on account %s: %s',
                tinkoff_account_id,
                exc,
            )

        updated_count = 0
        updated_position_ids: set[int] = set()

        for security in securities:
            if not isinstance(security, dict):
                continue

            # GetPositions returns free and blocked balances separately.
            # For real holdings we need the total quantity on the broker account.
            quantity = _api_number_to_decimal(security.get('balance')) + _api_number_to_decimal(security.get('blocked'))
            if quantity <= 0:
                continue

            instrument_meta = _normalize_instrument_meta({}, security)
            enriched_instrument_meta = await _enrich_instrument_meta(client, instrument_meta)
            portfolio_position = _find_matching_portfolio_position(enriched_instrument_meta, portfolio_positions_raw)
            pos_id = await self._find_position(conn, linked_account_id, enriched_instrument_meta)
            if pos_id is None:
                pos_id = await _recover_missing_current_position(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    enriched_instrument_meta,
                    portfolio_position or {},
                    quantity,
                )
            if pos_id is None or pos_id in updated_position_ids:
                continue

            await conn.execute(
                '''UPDATE budgeting.portfolio_positions
                   SET asset_type_code = 'security',
                       quantity = $2::numeric
                   WHERE id = $1''',
                pos_id,
                quantity,
            )
            await _refresh_position_metadata(conn, pos_id, enriched_instrument_meta)
            await _backfill_bond_clean_amount_from_portfolio(
                conn,
                pos_id,
                enriched_instrument_meta,
                portfolio_position,
            )
            updated_position_ids.add(pos_id)
            updated_count += 1

        return updated_count

    async def _apply_deposit_resolution(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        owner_type: str,
        owner_user_id: Optional[int],
        owner_family_id: Optional[int],
        linked_account_id: int,
        tinkoff_op_id: str,
        amount: Decimal,
        currency: str,
        resolution: str,
        source_account_id: Optional[int],
    ) -> None:
        abs_amount = abs(amount)

        if resolution == 'external':
            await conn.fetchval(
                '''SELECT budgeting.put__record_broker_input(
                    $1::bigint, $2::text, $3::bigint, $4::bigint,
                    $5::bigint, $6::char(3), $7::numeric,
                    $8::text, $9::varchar(30), $10::text
                )''',
                user_id, owner_type, owner_user_id, owner_family_id,
                linked_account_id, currency, abs_amount,
                tinkoff_op_id, 'tinkoff', 'Tinkoff: пополнение счёта',
            )

        elif resolution == 'transfer':
            if source_account_id is None:
                raise ValueError('source_account_id required for transfer resolution')

            src_row = await conn.fetchrow(
                '''SELECT COALESCE(amount, 0) AS amount
                   FROM budgeting.current_bank_balances
                   WHERE bank_account_id = $1 AND currency_code = $2''',
                source_account_id, currency,
            )
            src_balance = Decimal(str(src_row['amount'])) if src_row else Decimal('0')
            if src_balance < abs_amount:
                raise ValueError(
                    'Недостаточно денег на счёте-источнике для этого исторического перевода. '
                    'Выберите "Внешнее пополнение" или сначала отразите перевод в боте.'
                )

            await conn.execute(
                '''SELECT budgeting.put__record_broker_transfer_in(
                    $1::bigint, $2::text, $3::bigint, $4::bigint,
                    $5::bigint, $6::bigint, $7::char(3), $8::numeric,
                    $9::text, $10::varchar(30), $11::text
                )''',
                user_id, owner_type, owner_user_id, owner_family_id,
                source_account_id, linked_account_id, currency, abs_amount,
                tinkoff_op_id, 'tinkoff', 'Tinkoff: перевод на брокерский счёт',
            )

        elif resolution == 'already_recorded':
            # amount=0 → idempotency marker only, no balance change
            await conn.execute(
                '''SELECT budgeting.put__record_broker_input(
                    $1::bigint, $2::text, $3::bigint, $4::bigint,
                    $5::bigint, $6::char(3), $7::numeric,
                    $8::text, $9::varchar(30), $10::text
                )''',
                user_id, owner_type, owner_user_id, owner_family_id,
                linked_account_id, currency, 0,
                tinkoff_op_id, 'tinkoff', 'Tinkoff: пополнение (уже учтено)',
            )

    async def _require_investment_balance(
        self,
        conn: asyncpg.Connection,
        linked_account_id: int,
        currency: str,
        required_amount: Decimal,
    ) -> None:
        """Validate that imported broker cash movements cover downstream trades."""
        row = await conn.fetchrow(
            '''SELECT COALESCE(amount, 0) AS amount
               FROM budgeting.current_bank_balances
               WHERE bank_account_id = $1 AND currency_code = $2''',
            linked_account_id, currency,
        )
        current_balance = Decimal(str(row['amount'])) if row else Decimal('0')
        if current_balance < required_amount:
            raise ValueError(
                'Недостаточно средств на инвестиционном счёте для исторической операции из Тинькофф. '
                'Проверьте, что предыдущие пополнения импортируются как "Внешнее пополнение" '
                'или "Перевод со счёта".'
            )

    async def _apply_auto_operation(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        linked_account_id: int,
        op: dict,
        mapped: dict,
        instrument_meta: Optional[dict] = None,
        owner_type: str = 'user',
        owner_user_id: Optional[int] = None,
        owner_family_id: Optional[int] = None,
        current_portfolio_positions: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        instrument_meta = instrument_meta or {}
        kind     = mapped['kind']
        figi     = instrument_meta.get('figi') or mapped['figi']
        payment  = _money_value_to_decimal(op.get('payment', {}))
        amount   = abs(payment)  # Decimal — avoids float precision issues
        currency = _op_currency(op)
        if not currency:
            return
        op_date  = _op_date(op)
        qty      = op.get('quantity')
        quantity = Decimal(str(qty)) if qty else None
        op_id    = op['id']
        instrument_title = (
            instrument_meta.get('name')
            or instrument_meta.get('ticker')
            or figi
        )
        unmatched_comment = f'Tinkoff: операция без найденной позиции · {instrument_title}'
        position_metadata = {
            'figi': instrument_meta.get('figi') or figi,
            'instrument_uid': instrument_meta.get('instrument_uid', ''),
            'position_uid': instrument_meta.get('position_uid', ''),
            'asset_uid': instrument_meta.get('asset_uid', ''),
            'ticker': instrument_meta.get('ticker', ''),
            'class_code': instrument_meta.get('class_code', ''),
            'exchange': instrument_meta.get('exchange', ''),
            'logo_name': instrument_meta.get('logo_name', ''),
            'security_kind': instrument_meta.get('security_kind', 'stock'),
            'import_source': 'tinkoff',
        }
        moex_market = instrument_meta.get('moex_market')
        if moex_market:
            position_metadata['moex_market'] = moex_market

        async def recover_current_position_if_needed() -> Optional[int]:
            if not current_portfolio_positions:
                return None

            portfolio_position = _find_matching_portfolio_position(instrument_meta, current_portfolio_positions)
            if portfolio_position is None:
                return None

            recovered_quantity = _portfolio_position_quantity(portfolio_position)
            if recovered_quantity <= 0:
                return None

            pos_id = await _recover_missing_current_position(
                conn,
                user_id,
                owner_type,
                owner_user_id,
                owner_family_id,
                linked_account_id,
                instrument_meta,
                portfolio_position,
                recovered_quantity,
            )
            if pos_id is None:
                return None

            await _refresh_position_metadata(conn, pos_id, instrument_meta)
            await _backfill_bond_clean_amount_from_portfolio(
                conn,
                pos_id,
                instrument_meta,
                portfolio_position,
            )
            return pos_id

        if kind == 'buy':
            await self._require_investment_balance(conn, linked_account_id, currency, amount)
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id is None:
                result = await conn.fetchval(
                    '''SELECT budgeting.put__create_portfolio_position(
                        $1::bigint, $2::bigint, $3::text, $4::text,
                        $5::numeric, $6::numeric, $7::char(3), $8::date,
                        NULL::text, $9::jsonb
                    )''',
                    user_id, linked_account_id, 'security', instrument_title,
                    quantity, amount, currency, op_date,
                    position_metadata,
                )
                data = json.loads(result) if isinstance(result, str) else result
                pos_id = data.get('id') if data else None
                event_type = 'open'
            else:
                await conn.execute(
                    '''SELECT budgeting.put__top_up_portfolio_position(
                        $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                        $5::numeric, $6::date
                    )''',
                    user_id, pos_id, amount, currency, quantity, op_date,
                )
                event_type = 'top_up'

            if pos_id:
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE id = (
                           SELECT id FROM budgeting.portfolio_events
                           WHERE position_id = $2 AND event_type = $3 AND external_id IS NULL
                           ORDER BY id DESC LIMIT 1
                       )''',
                    op_id, pos_id, event_type,
                )
                await _refresh_position_metadata(conn, pos_id, instrument_meta)

                if _is_bond_position(instrument_meta, position_metadata):
                    clean_amount, accrued_interest = _extract_bond_trade_components(op, amount, quantity)
                    await _apply_bond_cost_metadata_delta(
                        conn,
                        pos_id,
                        clean_amount,
                        accrued_interest,
                    )

        elif kind in ('dividend', 'coupon'):
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id is None:
                pos_id = await recover_current_position_if_needed()
            if pos_id:
                income_kind = kind
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_income(
                        $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                        NULL::numeric, $5::text, $6::date
                    )''',
                    user_id, pos_id, amount, currency, income_kind, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE id = (
                           SELECT id FROM budgeting.portfolio_events
                           WHERE position_id = $2 AND event_type = 'income' AND external_id IS NULL
                           ORDER BY id DESC LIMIT 1
                        )''',
                    op_id, pos_id,
                )
                await _refresh_position_metadata(conn, pos_id, instrument_meta)
            else:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    amount,
                    currency,
                    op_id,
                    unmatched_comment,
                    'investment_income',
                )
                logger.warning(
                    'Recorded unmatched %s as cash-only import for %s (%s)',
                    kind,
                    instrument_title,
                    op_id,
                )

        elif kind == 'bond_repayment':
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id is None:
                pos_id = await recover_current_position_if_needed()
            if pos_id:
                await _refresh_position_metadata(conn, pos_id, instrument_meta)
                pos_row = await conn.fetchrow(
                    '''SELECT amount_in_currency
                       FROM budgeting.portfolio_positions
                       WHERE id = $1''',
                    pos_id,
                )
                current_amount_in_currency = Decimal(str(pos_row['amount_in_currency'])) if pos_row else Decimal('0')
                if amount >= current_amount_in_currency:
                    await conn.execute(
                        '''SELECT budgeting.put__close_portfolio_position(
                            $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                            NULL::numeric, $5::date, $6::text
                        )''',
                        user_id,
                        pos_id,
                        amount,
                        currency,
                        op_date,
                        'Tinkoff: полное погашение облигации',
                    )
                    await conn.execute(
                        '''UPDATE budgeting.portfolio_events
                           SET external_id = $1, import_source = 'tinkoff'
                           WHERE id = (
                               SELECT id FROM budgeting.portfolio_events
                               WHERE position_id = $2 AND event_type = 'close' AND external_id IS NULL
                               ORDER BY id DESC LIMIT 1
                           )''',
                        op_id,
                        pos_id,
                    )
                else:
                    await _record_position_principal_repayment(
                        conn,
                        user_id,
                        pos_id,
                        amount,
                        currency,
                        amount,
                        op_date,
                        op_id,
                        'Tinkoff: частичное погашение облигации',
                    )
                    await conn.execute(
                        '''UPDATE budgeting.portfolio_events
                           SET external_id = $1, import_source = 'tinkoff'
                           WHERE id = (
                               SELECT id FROM budgeting.portfolio_events
                               WHERE position_id = $2
                                 AND event_type = 'adjustment'
                                 AND COALESCE(metadata ->> 'action', '') = 'bond_repayment'
                                 AND external_id IS NULL
                               ORDER BY id DESC LIMIT 1
                           )''',
                        op_id,
                        pos_id,
                    )
            else:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    amount,
                    currency,
                    op_id,
                    unmatched_comment,
                    'investment_adjustment',
                )
                logger.warning(
                    'Recorded unmatched %s as cash-only import for %s (%s)',
                    kind,
                    instrument_title,
                    op_id,
                )

        elif kind == 'bond_repayment_full':
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id:
                await _refresh_position_metadata(conn, pos_id, instrument_meta)
                await conn.execute(
                    '''SELECT budgeting.put__close_portfolio_position(
                        $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                        NULL::numeric, $5::date, $6::text
                    )''',
                    user_id,
                    pos_id,
                    amount,
                    currency,
                    op_date,
                    'Tinkoff: полное погашение облигации',
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE id = (
                           SELECT id FROM budgeting.portfolio_events
                           WHERE position_id = $2 AND event_type = 'close' AND external_id IS NULL
                           ORDER BY id DESC LIMIT 1
                       )''',
                    op_id,
                    pos_id,
                )
            else:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    amount,
                    currency,
                    op_id,
                    unmatched_comment,
                    'investment_adjustment',
                )
                logger.warning(
                    'Recorded unmatched %s as cash-only import for %s (%s)',
                    kind,
                    instrument_title,
                    op_id,
                )

        elif kind in ('broker_fee', 'tax'):
            if payment > 0:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    amount,
                    currency,
                    op_id,
                    f'Tinkoff: возврат удержания · {instrument_title}' if instrument_title else 'Tinkoff: возврат удержания',
                    'investment_adjustment',
                )
                logger.warning(
                    'Recorded positive %s correction as cash-only import for %s (%s)',
                    kind,
                    instrument_title,
                    op_id,
                )
                return

            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id:
                await _refresh_position_metadata(conn, pos_id, instrument_meta)
                await self._require_investment_balance(conn, linked_account_id, currency, amount)
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_fee(
                        $1::bigint, $2::bigint, $3::numeric, $4::char(3), $5::date
                    )''',
                    user_id, pos_id, amount, currency, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE id = (
                           SELECT id FROM budgeting.portfolio_events
                           WHERE position_id = $2 AND event_type = 'fee' AND external_id IS NULL
                           ORDER BY id DESC LIMIT 1
                        )''',
                    op_id, pos_id,
                )
            else:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    -amount,
                    currency,
                    op_id,
                    unmatched_comment,
                    'investment_adjustment',
                )
                logger.warning(
                    'Recorded unmatched %s as cash-only import for %s (%s)',
                    kind,
                    instrument_title,
                    op_id,
                )

        elif kind == 'sell':
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id:
                await _refresh_position_metadata(conn, pos_id, instrument_meta)
                pos_row = await conn.fetchrow(
                    '''SELECT quantity,
                              amount_in_currency,
                              COALESCE((metadata ->> 'amount_in_base')::numeric, 0) AS amount_in_base,
                              (metadata ->> 'clean_amount_in_base')::numeric AS clean_amount_in_base
                       FROM budgeting.portfolio_positions
                       WHERE id = $1''',
                    pos_id,
                )
                current_quantity = None
                current_amount_in_currency = None
                current_amount_in_base = None
                current_clean_amount_in_base = None
                if pos_row is not None and pos_row['quantity'] is not None:
                    current_quantity = Decimal(str(pos_row['quantity']))
                if pos_row is not None and pos_row['amount_in_currency'] is not None:
                    current_amount_in_currency = Decimal(str(pos_row['amount_in_currency']))
                if pos_row is not None and pos_row['amount_in_base'] is not None:
                    current_amount_in_base = Decimal(str(pos_row['amount_in_base']))
                if pos_row is not None and pos_row['clean_amount_in_base'] is not None:
                    current_clean_amount_in_base = Decimal(str(pos_row['clean_amount_in_base']))

                base_currency = await conn.fetchval(
                    'SELECT budgeting.get__owner_base_currency($1::text, $2::bigint, $3::bigint)',
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                )
                close_amount_in_base: Optional[Decimal] = None
                if (
                    str(base_currency or '').upper() != currency.upper()
                    and amount > 0
                    and current_amount_in_currency is not None
                    and current_amount_in_currency > 0
                    and current_amount_in_base is not None
                    and current_amount_in_base > 0
                ):
                    close_amount_in_base = round(
                        current_amount_in_base * amount / current_amount_in_currency,
                        2,
                    )

                principal_reduction = amount
                if (
                    current_quantity is not None
                    and current_quantity > 0
                    and quantity is not None
                    and quantity > 0
                    and current_amount_in_currency is not None
                    and current_amount_in_currency > 0
                ):
                    principal_reduction = round(
                        current_amount_in_currency * quantity / current_quantity,
                        8,
                    )

                is_full_close = (
                    current_quantity is not None
                    and quantity is not None
                    and quantity >= current_quantity
                )

                if is_full_close:
                    await conn.execute(
                        '''SELECT budgeting.put__close_portfolio_position(
                            $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                            $5::numeric, $6::date
                        )''',
                        user_id, pos_id, amount, currency, close_amount_in_base, op_date,
                    )
                    event_types = ('close',)
                else:
                    await conn.execute(
                        # параметры: user, pos, return_amount, currency, principal_reduction,
                        #            return_amount_in_base (NULL), closed_quantity, closed_at
                        '''SELECT budgeting.put__partial_close_portfolio_position(
                            $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                            $5::numeric, $6::numeric, $7::numeric, $8::date
                        )''',
                        user_id,
                        pos_id,
                        amount,
                        currency,
                        principal_reduction,
                        close_amount_in_base,
                        quantity,
                        op_date,
                    )
                    if (
                        current_clean_amount_in_base is not None
                        and current_quantity is not None
                        and current_quantity > 0
                        and quantity is not None
                        and quantity > 0
                    ):
                        released_clean_principal_in_base = round(
                            current_clean_amount_in_base * min(quantity, current_quantity) / current_quantity,
                            2,
                        )
                        await conn.execute(
                            '''UPDATE budgeting.portfolio_positions
                               SET metadata = COALESCE(metadata, '{}'::jsonb)
                                              || jsonb_build_object(
                                                  'clean_amount_in_base',
                                                  $2::numeric
                                              )
                               WHERE id = $1''',
                            pos_id,
                            current_clean_amount_in_base - released_clean_principal_in_base,
                        )
                    event_types = ('partial_close', 'close')

                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE id = (
                           SELECT id FROM budgeting.portfolio_events
                           WHERE position_id = $2
                             AND event_type = ANY($3::varchar[])
                             AND external_id IS NULL
                           ORDER BY id DESC LIMIT 1
                        )''',
                    op_id, pos_id, list(event_types),
                )
            else:
                await _record_unmatched_cash_only(
                    conn,
                    user_id,
                    owner_type,
                    owner_user_id,
                    owner_family_id,
                    linked_account_id,
                    amount,
                    currency,
                    op_id,
                    unmatched_comment,
                    'investment_adjustment',
                )
                logger.warning(
                    'Recorded unmatched sell as cash-only import for %s (%s)',
                    instrument_title,
                    op_id,
                )


# ---------------------------------------------------------------------------
# TinkoffConnections  (CRUD for external_connections)
# ---------------------------------------------------------------------------

class TinkoffConnections:

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def get_accounts_from_token(self, token: str) -> list[dict]:
        client = TinkoffRestClient(token)
        accounts = await client.get_accounts()
        return [
            {
                'provider_account_id': acc.get('id', ''),
                'name': acc.get('name', ''),
                'type': acc.get('type', ''),
            }
            for acc in accounts
        ]

    async def list_connections(self, user_id: int) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT ec.id, ec.provider, ec.provider_account_id,
                          ec.linked_account_id, ec.last_synced_at, ec.is_active,
                          ec.settings, ec.created_at,
                          ba.name AS linked_account_name
                   FROM budgeting.external_connections ec
                   LEFT JOIN budgeting.bank_accounts ba ON ba.id = ec.linked_account_id
                   WHERE ec.provider = 'tinkoff'
                     AND (
                       (ec.owner_type = 'user' AND ec.owner_user_id = $1)
                       OR
                       (ec.owner_type = 'family' AND ec.owner_family_id = (
                           SELECT family_id FROM budgeting.family_members WHERE user_id = $1 LIMIT 1
                       ))
                     )
                     AND ec.is_active = true
                   ORDER BY ec.created_at''',
                user_id,
            )
            return [dict(r) for r in rows]

    async def create_connection(
        self,
        user_id: int,
        token: str,
        provider_account_id: str,
        linked_account_id: int,
    ) -> dict:
        async with self._pool.acquire() as conn:
            family_row = await conn.fetchrow(
                'SELECT family_id FROM budgeting.family_members WHERE user_id = $1 LIMIT 1',
                user_id,
            )
            if family_row:
                owner_type      = 'family'
                owner_user_id   = None
                owner_family_id = family_row['family_id']
            else:
                owner_type      = 'user'
                owner_user_id   = user_id
                owner_family_id = None

            credentials = {'token': token}
            row = await conn.fetchrow(
                '''INSERT INTO budgeting.external_connections
                   (owner_type, owner_user_id, owner_family_id, provider,
                    provider_account_id, linked_account_id, credentials)
                   VALUES ($1, $2, $3, 'tinkoff', $4, $5, $6)
                   ON CONFLICT (provider, provider_account_id, owner_user_id, owner_family_id)
                   DO UPDATE SET
                       credentials = EXCLUDED.credentials,
                       linked_account_id = EXCLUDED.linked_account_id,
                       is_active = true
                   RETURNING id, provider_account_id, linked_account_id, created_at''',
                owner_type, owner_user_id, owner_family_id,
                provider_account_id, linked_account_id, credentials,
            )
            return dict(row)

    async def delete_connection(self, connection_id: int, user_id: int) -> None:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                '''UPDATE budgeting.external_connections
                   SET is_active = false
                   WHERE id = $1
                     AND (
                       (owner_type = 'user' AND owner_user_id = $2)
                       OR
                       (owner_type = 'family' AND owner_family_id = (
                           SELECT family_id FROM budgeting.family_members WHERE user_id = $2 LIMIT 1
                       ))
                     )''',
                connection_id, user_id,
            )
            if result == 'UPDATE 0':
                raise ValueError(f'Connection {connection_id} not found or not accessible')
