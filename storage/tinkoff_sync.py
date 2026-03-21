"""
Tinkoff Investments sync module.

Uses the Tinkoff Invest REST API (gRPC-gateway) directly via httpx.
No third-party SDK required — only httpx (standard package).

REST base: https://invest-public-api.tinkoff.ru/rest
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import asyncpg
import httpx


TINKOFF_REST_URL = 'https://invest-public-api.tinkoff.ru/rest'

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
    'OPERATION_TYPE_BOND_REPAYMENT':                'coupon',
    'OPERATION_TYPE_BOND_REPAYMENT_FULL':           'coupon',
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

        return _sort_operations_chronologically(all_items)

    async def get_positions(self, account_id: str) -> dict:
        return await self._post(
            'tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions',
            {'accountId': account_id},
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
    # Tinkoff response order is not guaranteed for our business logic, so we
    # normalize it explicitly by operation timestamp.
    return sorted(ops, key=lambda op: (_op_datetime(op), str(op.get('id', ''))))


def _op_currency(op: dict) -> str:
    """Extract currency: top-level field first, then payment.currency."""
    currency = (op.get('currency') or '').upper().strip()
    if not currency:
        payment = op.get('payment') or {}
        currency = (payment.get('currency') or '').upper().strip()
    return currency


def _infer_moex_market(class_code: str, exchange: str) -> Optional[str]:
    normalized_class_code = class_code.upper().strip()
    normalized_exchange = exchange.upper().strip()

    if normalized_class_code.startswith('TQO'):
        return 'bonds'

    if normalized_class_code in {'TQBR', 'TQTF', 'TQIF', 'TQPI', 'TQTD'}:
        return 'shares'

    if 'MOEX' in normalized_exchange and normalized_class_code:
        return 'shares'

    return None


def _infer_security_kind(instrument_type: str, class_code: str) -> str:
    normalized_type = instrument_type.lower().strip()
    normalized_class_code = class_code.upper().strip()

    if normalized_class_code.startswith('TQO') or 'bond' in normalized_type:
        return 'bond'

    if any(token in normalized_type for token in ('etf', 'fund', 'share_type_etf', 'share_type_bpif')):
        return 'fund'

    return 'stock'


def _operation_instrument_cache_key(op: dict) -> str:
    return _op_field(op, 'positionUid', 'position_uid', 'instrumentUid', 'instrument_uid', 'figi')


def _normalize_instrument_meta(op: dict, raw: Optional[dict] = None) -> dict:
    raw = raw or {}

    figi = _op_field(raw, 'figi') or _op_field(op, 'figi')
    instrument_uid = _op_field(raw, 'uid', 'instrumentUid', 'instrument_uid') or _op_field(op, 'instrumentUid', 'instrument_uid')
    position_uid = _op_field(raw, 'positionUid', 'position_uid') or _op_field(op, 'positionUid', 'position_uid')
    asset_uid = _op_field(raw, 'assetUid', 'asset_uid') or _op_field(op, 'assetUid', 'asset_uid')
    ticker = (_op_field(raw, 'ticker') or _op_field(op, 'ticker')).upper()
    class_code = (_op_field(raw, 'classCode', 'class_code') or _op_field(op, 'classCode', 'class_code')).upper()
    exchange = _op_field(raw, 'exchange', 'realExchange', 'real_exchange')
    instrument_type = _op_field(raw, 'instrumentType', 'instrument_type', 'instrumentKind', 'instrument_kind')
    name = _op_field(raw, 'name', 'shortName', 'short_name')

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
        'moex_market': moex_market,
        'security_kind': security_kind,
    }


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

    @staticmethod
    def _get_since(conn_row: dict) -> datetime:
        """Return sync start datetime from connection settings, or 5 years ago."""
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
        return datetime.now(timezone.utc) - timedelta(days=5 * 365)

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
        since = self._get_since(conn_row) if conn_row else datetime.now(timezone.utc) - timedelta(days=5 * 365)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))
        instrument_map = await self._resolve_instrument_map(client, raw_ops)

        already_imported_ids = await self._get_already_imported_ids(raw_ops)

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
        since  = self._get_since(conn_row)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))
        instrument_map = await self._resolve_instrument_map(client, raw_ops)

        already_imported_ids = await self._get_already_imported_ids(raw_ops)
        resolutions_map = {r['tinkoff_op_id']: r for r in deposit_resolutions}

        applied_count = 0
        skipped_count = 0
        reconciled_positions = 0

        async with self._pool.acquire() as conn:
            async with conn.transaction():

                # Process ALL operations in chronological order (by date from Tinkoff API).
                # This ensures deposits are applied before the buys that spend the cash.
                for op in raw_ops:
                    op_id = op['id']

                    if op_id in already_imported_ids:
                        skipped_count += 1
                        continue

                    mapped = _map_operation(op)
                    currency = _op_currency(op)
                    if not currency:
                        continue

                    # Deposit/withdrawal with manual resolution
                    if op_id in resolutions_map:
                        payment = _money_value_to_decimal(op.get('payment', {}))
                        resolution = resolutions_map[op_id]
                        kind = resolution['resolution']
                        source_account_id = resolution.get('source_account_id')

                        await self._apply_deposit_resolution(
                            conn, user_id, owner_type, owner_user_id, owner_family_id,
                            linked_account_id, op_id, payment, currency, kind, source_account_id,
                        )
                        applied_count += 1
                        continue

                    # Skip unresolved deposits/withdrawals and unknown operations
                    if mapped['kind'] in ('input', 'output', 'unknown'):
                        continue

                    # Auto operations (buy, sell, dividend, fee, tax, etc.)
                    instrument_meta = self._get_instrument_meta(instrument_map, op)
                    await self._apply_auto_operation(
                        conn, user_id, linked_account_id, op, mapped, instrument_meta,
                        owner_type, owner_user_id, owner_family_id,
                    )
                    applied_count += 1

                reconciled_positions = await self._reconcile_current_quantities(
                    conn,
                    client,
                    tinkoff_account_id,
                    linked_account_id,
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
        resolved: dict[str, dict] = {}

        for op in raw_ops:
            cache_key = _operation_instrument_cache_key(op)
            if not cache_key or cache_key in resolved:
                continue

            raw_instrument: Optional[dict] = None
            resolution_attempts = [
                ('INSTRUMENT_ID_TYPE_POSITION_UID', _op_field(op, 'positionUid', 'position_uid')),
                ('INSTRUMENT_ID_TYPE_UID', _op_field(op, 'instrumentUid', 'instrument_uid')),
                ('INSTRUMENT_ID_TYPE_FIGI', _op_field(op, 'figi')),
            ]

            for id_type, instrument_id in resolution_attempts:
                if not instrument_id:
                    continue
                try:
                    raw_instrument = await client.get_instrument_by(instrument_id, id_type)
                    break
                except Exception:
                    continue

            resolved[cache_key] = _normalize_instrument_meta(op, raw_instrument)

        return resolved

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

        return None

    async def _reconcile_current_quantities(
        self,
        conn: asyncpg.Connection,
        client: TinkoffRestClient,
        tinkoff_account_id: str,
        linked_account_id: int,
    ) -> int:
        current_positions = await client.get_positions(tinkoff_account_id)
        securities = current_positions.get('securities', [])
        if not isinstance(securities, list):
            return 0

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
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id is None or pos_id in updated_position_ids:
                continue

            metadata_patch = {
                key: value
                for key, value in {
                    'figi': instrument_meta.get('figi', ''),
                    'instrument_uid': instrument_meta.get('instrument_uid', ''),
                    'position_uid': instrument_meta.get('position_uid', ''),
                    'ticker': instrument_meta.get('ticker', ''),
                    'class_code': instrument_meta.get('class_code', ''),
                }.items()
                if isinstance(value, str) and value
            }

            await conn.execute(
                '''UPDATE budgeting.portfolio_positions
                   SET asset_type_code = 'security',
                       quantity = $2::numeric,
                       metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
                   WHERE id = $1''',
                pos_id,
                quantity,
                metadata_patch,
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
        position_metadata = {
            'figi': instrument_meta.get('figi') or figi,
            'instrument_uid': instrument_meta.get('instrument_uid', ''),
            'position_uid': instrument_meta.get('position_uid', ''),
            'asset_uid': instrument_meta.get('asset_uid', ''),
            'ticker': instrument_meta.get('ticker', ''),
            'class_code': instrument_meta.get('class_code', ''),
            'exchange': instrument_meta.get('exchange', ''),
            'security_kind': instrument_meta.get('security_kind', 'stock'),
            'import_source': 'tinkoff',
        }
        moex_market = instrument_meta.get('moex_market')
        if moex_market:
            position_metadata['moex_market'] = moex_market

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

        elif kind in ('dividend', 'coupon'):
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
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

        elif kind in ('broker_fee', 'tax'):
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id:
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

        elif kind == 'sell':
            pos_id = await self._find_position(conn, linked_account_id, instrument_meta)
            if pos_id:
                pos_row = await conn.fetchrow(
                    '''SELECT quantity
                       FROM budgeting.portfolio_positions
                       WHERE id = $1''',
                    pos_id,
                )
                current_quantity = None
                if pos_row is not None and pos_row['quantity'] is not None:
                    current_quantity = Decimal(str(pos_row['quantity']))

                is_full_close = (
                    current_quantity is not None
                    and quantity is not None
                    and quantity >= current_quantity
                )

                if is_full_close:
                    await conn.execute(
                        '''SELECT budgeting.put__close_portfolio_position(
                            $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                            NULL::numeric, $5::date
                        )''',
                        user_id, pos_id, amount, currency, op_date,
                    )
                    event_types = ('close',)
                else:
                    await conn.execute(
                        # параметры: user, pos, return_amount, currency, principal_reduction,
                        #            return_amount_in_base (NULL), closed_quantity, closed_at
                        '''SELECT budgeting.put__partial_close_portfolio_position(
                            $1::bigint, $2::bigint, $3::numeric, $4::char(3),
                            $3::numeric, NULL::numeric, $5::numeric, $6::date
                        )''',
                        user_id, pos_id, amount, currency, quantity, op_date,
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
