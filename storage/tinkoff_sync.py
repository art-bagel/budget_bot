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
    'OPERATION_TYPE_INPUT':        'input',
    'OPERATION_TYPE_OUTPUT':       'output',
    'OPERATION_TYPE_BUY':          'buy',
    'OPERATION_TYPE_SELL':         'sell',
    'OPERATION_TYPE_DIVIDEND':     'dividend',
    'OPERATION_TYPE_COUPON':       'coupon',
    'OPERATION_TYPE_BROKER_FEE':   'broker_fee',
    'OPERATION_TYPE_TAX':          'tax',
    'OPERATION_TYPE_TAX_DIVIDEND': 'tax',
    'OPERATION_TYPE_TAX_COUPON':   'tax',
    'OPERATION_TYPE_TAX_LUCRE':    'tax',
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

    async def get_operations(
        self,
        account_id: str,
        since: datetime,
        to: datetime,
    ) -> list[dict]:
        data = await self._post(
            'tinkoff.public.invest.api.contract.v1.OperationsService/GetOperations',
            {
                'accountId': account_id,
                'from': since.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'to': to.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'state': 'OPERATION_STATE_EXECUTED',
            },
        )
        return data.get('operations', [])


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


def _op_date(op: dict) -> date:
    raw = op.get('date', '')
    return datetime.fromisoformat(raw.replace('Z', '+00:00')).date()


def _map_operation(op: dict) -> dict:
    kind = _OP_TYPE_MAP.get(op.get('operationType', ''), 'unknown')
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

    # ── Public API ──────────────────────────────────────────────────────────

    async def preview(
        self,
        token: str,
        tinkoff_account_id: str,
        linked_account_id: int,
        user_id: int,
    ) -> dict:
        """Dry-run: classify operations without writing to DB."""
        client = TinkoffRestClient(token)
        since = datetime.now(timezone.utc) - timedelta(days=365)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))

        already_imported_ids = await self._get_already_imported_ids(raw_ops)

        deposits:        list[dict] = []
        withdrawals:     list[dict] = []
        auto_operations: list[dict] = []

        for op in raw_ops:
            op_id   = op['id']
            already = op_id in already_imported_ids
            mapped  = _map_operation(op)
            payment = _money_value_to_decimal(op.get('payment', {}))
            currency = (op.get('currency') or '').upper()
            qty = op.get('quantity')

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
                auto_operations.append({
                    'tinkoff_op_id': op_id,
                    'type': mapped['kind'],
                    'ticker': '',
                    'figi': mapped['figi'],
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
        token              = conn_row['credentials']['token']
        tinkoff_account_id = conn_row['provider_account_id']
        linked_account_id  = conn_row['linked_account_id']

        client = TinkoffRestClient(token)
        since  = datetime.now(timezone.utc) - timedelta(days=365)
        raw_ops = await client.get_operations(tinkoff_account_id, since, datetime.now(timezone.utc))

        ops_by_id: dict[str, dict] = {op['id']: op for op in raw_ops}
        already_imported_ids = await self._get_already_imported_ids(raw_ops)
        resolutions_map = {r['tinkoff_op_id']: r for r in deposit_resolutions}

        applied_count = 0
        skipped_count = 0

        async with self._pool.acquire() as conn:
            async with conn.transaction():

                # 1. Deposits/withdrawals with manual resolution
                for op_id, resolution in resolutions_map.items():
                    if op_id in already_imported_ids:
                        skipped_count += 1
                        continue
                    op = ops_by_id.get(op_id)
                    if op is None:
                        continue

                    payment  = _money_value_to_decimal(op.get('payment', {}))
                    currency = (op.get('currency') or '').upper()
                    op_date  = _op_date(op)
                    kind     = resolution['resolution']
                    source_account_id = resolution.get('source_account_id')

                    await self._apply_deposit_resolution(
                        conn, user_id, linked_account_id, op_id,
                        float(payment), currency, op_date, kind, source_account_id,
                    )
                    applied_count += 1

                # 2. Auto operations
                for op in raw_ops:
                    if op['id'] in already_imported_ids:
                        skipped_count += 1
                        continue
                    if op['id'] in resolutions_map:
                        continue

                    mapped = _map_operation(op)
                    if mapped['kind'] in ('input', 'output', 'unknown'):
                        continue

                    await self._apply_auto_operation(
                        conn, user_id, linked_account_id, op, mapped,
                    )
                    applied_count += 1

                # 3. Update last_synced_at
                await conn.execute(
                    'UPDATE budgeting.external_connections SET last_synced_at = now() WHERE id = $1',
                    connection_id,
                )

        return {
            'status': 'ok',
            'applied': applied_count,
            'skipped_already_imported': skipped_count,
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

    async def _find_position(
        self,
        conn: asyncpg.Connection,
        linked_account_id: int,
        figi: str,
    ) -> Optional[int]:
        row = await conn.fetchrow(
            '''SELECT id FROM budgeting.portfolio_positions
               WHERE investment_account_id = $1
                 AND status = 'open'
                 AND (metadata->>'figi' = $2 OR title = $2)
               LIMIT 1''',
            linked_account_id, figi,
        )
        return row['id'] if row else None

    async def _apply_deposit_resolution(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        linked_account_id: int,
        tinkoff_op_id: str,
        amount: float,
        currency: str,
        op_date: date,
        resolution: str,
        source_account_id: Optional[int],
    ) -> None:
        abs_amount = abs(amount)

        if resolution == 'external':
            # Record as broker cash inflow — money arrives from outside, no account debited
            await conn.execute(
                '''INSERT INTO budgeting.bank_entries
                   (bank_account_id, amount, currency_code, entry_date,
                    entry_type, external_id, import_source, created_by_user_id)
                   VALUES ($1, $2, $3, $4, 'broker_input', $5, 'tinkoff', $6)
                   ON CONFLICT DO NOTHING''',
                linked_account_id, abs_amount, currency, op_date,
                tinkoff_op_id, user_id,
            )

        elif resolution == 'transfer':
            if source_account_id is None:
                raise ValueError('source_account_id required for transfer resolution')
            # Debit source account
            await conn.execute(
                '''INSERT INTO budgeting.bank_entries
                   (bank_account_id, amount, currency_code, entry_date, entry_type, created_by_user_id)
                   VALUES ($1, $2, $3, $4, 'transfer_out', $5)''',
                source_account_id, -abs_amount, currency, op_date, user_id,
            )
            # Credit investment account
            await conn.execute(
                '''INSERT INTO budgeting.bank_entries
                   (bank_account_id, amount, currency_code, entry_date,
                    entry_type, external_id, import_source, created_by_user_id)
                   VALUES ($1, $2, $3, $4, 'transfer_in', $5, 'tinkoff', $6)
                   ON CONFLICT DO NOTHING''',
                linked_account_id, abs_amount, currency, op_date,
                tinkoff_op_id, user_id,
            )

        elif resolution == 'already_recorded':
            # Money is already in the investment account — just mark op as processed
            await conn.execute(
                '''INSERT INTO budgeting.bank_entries
                   (bank_account_id, amount, currency_code, entry_date,
                    entry_type, external_id, import_source, created_by_user_id)
                   VALUES ($1, 0, $2, $3, 'broker_input_ack', $4, 'tinkoff', $5)
                   ON CONFLICT DO NOTHING''',
                linked_account_id, currency, op_date, tinkoff_op_id, user_id,
            )

    async def _apply_auto_operation(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        linked_account_id: int,
        op: dict,
        mapped: dict,
    ) -> None:
        kind     = mapped['kind']
        figi     = mapped['figi']
        payment  = _money_value_to_decimal(op.get('payment', {}))
        amount   = float(abs(payment))
        currency = (op.get('currency') or '').upper()
        op_date  = _op_date(op)
        qty      = op.get('quantity')
        quantity = float(qty) if qty else None
        op_id    = op['id']

        if kind == 'buy':
            pos_id = await self._find_position(conn, linked_account_id, figi)
            if pos_id is None:
                result = await conn.fetchval(
                    '''SELECT budgeting.put__create_portfolio_position(
                        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
                    )''',
                    user_id, linked_account_id, 'stock', figi,
                    quantity, amount, currency, op_date,
                    json.dumps({'figi': figi, 'import_source': 'tinkoff'}),
                )
                data = json.loads(result) if isinstance(result, str) else result
                pos_id = data.get('id') if data else None
                event_type = 'open'
            else:
                await conn.execute(
                    '''SELECT budgeting.put__top_up_portfolio_position($1,$2,$3,$4,$5,$6)''',
                    user_id, pos_id, amount, currency, quantity, op_date,
                )
                event_type = 'top_up'

            if pos_id:
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2 AND event_type = $3 AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id, event_type,
                )

        elif kind in ('dividend', 'coupon'):
            pos_id = await self._find_position(conn, linked_account_id, figi)
            if pos_id:
                income_kind = kind  # 'dividend' or 'coupon'
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_income($1,$2,$3,$4,$5,$6,$7)''',
                    user_id, pos_id, amount, currency, None, income_kind, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2 AND event_type = 'income' AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
                )

        elif kind in ('broker_fee', 'tax'):
            pos_id = await self._find_position(conn, linked_account_id, figi)
            if pos_id:
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_fee($1,$2,$3,$4,$5)''',
                    user_id, pos_id, amount, currency, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2 AND event_type = 'fee' AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
                )

        elif kind == 'sell':
            pos_id = await self._find_position(conn, linked_account_id, figi)
            if pos_id:
                await conn.execute(
                    '''SELECT budgeting.put__partial_close_portfolio_position($1,$2,$3,$4,$5,$6,$7)''',
                    user_id, pos_id, amount, currency, amount, quantity, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2
                         AND event_type IN ('partial_close','close')
                         AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
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

            credentials = json.dumps({'token': token})
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
