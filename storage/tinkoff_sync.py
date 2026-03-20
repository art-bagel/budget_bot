"""
Tinkoff Investments sync module.

Handles preview (dry-run) and apply (write) of operations fetched from
Tinkoff Invest API.  Intentionally isolated — does not subclass DataBase;
uses raw asyncpg connections obtained from an existing pool.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import asyncpg

# ---------------------------------------------------------------------------
# Tinkoff SDK imports (tinkoff-investments package)
# ---------------------------------------------------------------------------
try:
    from tinkoff.invest import (
        AsyncClient,
        OperationState,
        OperationType,
    )
    from tinkoff.invest.utils import money_to_decimal
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False
    money_to_decimal = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Tinkoff operation type → our event_type mapping
# ---------------------------------------------------------------------------

_OP_TYPE_MAP: dict[str, str] = {}

if _SDK_AVAILABLE:
    _OP_TYPE_MAP = {
        OperationType.OPERATION_TYPE_BUY.name:          'buy',
        OperationType.OPERATION_TYPE_SELL.name:         'sell',
        OperationType.OPERATION_TYPE_DIVIDEND.name:     'dividend',
        OperationType.OPERATION_TYPE_COUPON.name:       'coupon',
        OperationType.OPERATION_TYPE_BROKER_FEE.name:   'broker_fee',
        OperationType.OPERATION_TYPE_TAX_DIVIDEND.name: 'tax',
        OperationType.OPERATION_TYPE_INPUT.name:        'input',
        OperationType.OPERATION_TYPE_OUTPUT.name:       'output',
    }


def _money_value_to_decimal(mv) -> Decimal:
    """Convert Tinkoff MoneyValue / Quotation to Decimal."""
    if money_to_decimal is not None:
        return money_to_decimal(mv)
    # fallback manual conversion
    return Decimal(mv.units) + Decimal(mv.nano) / Decimal('1000000000')


def _op_date(op) -> date:
    """Extract date from operation.date (protobuf Timestamp)."""
    dt: datetime = op.date.ToDatetime(tzinfo=timezone.utc)
    return dt.date()


class TinkoffSync:
    """
    Stateless helper that talks to Tinkoff Invest API and writes to our DB.

    Usage:
        sync = TinkoffSync(pool)
        preview = await sync.preview(token, tinkoff_account_id, linked_account_id, user_id)
        result  = await sync.apply(connection_id, deposit_resolutions, user_id)
    """

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def preview(
        self,
        token: str,
        tinkoff_account_id: str,
        linked_account_id: int,
        user_id: int,
    ) -> dict:
        """
        Dry-run: fetch operations from Tinkoff and classify them.
        Nothing is written to the database.
        """
        if not _SDK_AVAILABLE:
            raise RuntimeError('tinkoff-investments package is not installed')

        since = await self._get_sync_from(linked_account_id)
        raw_ops = await self._fetch_operations(token, tinkoff_account_id, since)

        already_imported_ids = await self._get_already_imported_ids(raw_ops)

        deposits: list[dict] = []
        withdrawals: list[dict] = []
        auto_operations: list[dict] = []

        for op in raw_ops:
            op_id = op.id
            already = op_id in already_imported_ids
            mapped = self._map_operation(op)

            if mapped['kind'] == 'input':
                deposits.append({
                    'tinkoff_op_id': op_id,
                    'amount': float(_money_value_to_decimal(op.payment)),
                    'currency_code': op.currency.upper(),
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })
            elif mapped['kind'] == 'output':
                withdrawals.append({
                    'tinkoff_op_id': op_id,
                    'amount': float(abs(_money_value_to_decimal(op.payment))),
                    'currency_code': op.currency.upper(),
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })
            else:
                auto_operations.append({
                    'tinkoff_op_id': op_id,
                    'type': mapped['kind'],
                    'ticker': mapped.get('ticker', ''),
                    'figi': mapped.get('figi', ''),
                    'amount': float(abs(_money_value_to_decimal(op.payment))),
                    'quantity': float(op.quantity) if op.quantity else None,
                    'currency_code': op.currency.upper(),
                    'date': _op_date(op).isoformat(),
                    'already_imported': already,
                })

        total_new = sum(
            1 for item in deposits + withdrawals + auto_operations
            if not item['already_imported']
        )
        total_already = sum(
            1 for item in deposits + withdrawals + auto_operations
            if item['already_imported']
        )

        return {
            'deposits': deposits,
            'withdrawals': withdrawals,
            'auto_operations': auto_operations,
            'total_new': total_new,
            'total_already_imported': total_already,
        }

    async def apply(
        self,
        connection_id: int,
        deposit_resolutions: list[dict],
        user_id: int,
    ) -> dict:
        """
        Apply synced operations.  Runs in a single DB transaction.

        deposit_resolutions items:
            tinkoff_op_id  – str
            resolution     – 'external' | 'transfer' | 'already_recorded'
            source_account_id – int | None  (required for 'transfer')
        """
        if not _SDK_AVAILABLE:
            raise RuntimeError('tinkoff-investments package is not installed')

        conn_row = await self._get_connection(connection_id, user_id)
        token = conn_row['credentials']['token']
        tinkoff_account_id = conn_row['provider_account_id']
        linked_account_id = conn_row['linked_account_id']

        since = await self._get_sync_from(linked_account_id)
        raw_ops = await self._fetch_operations(token, tinkoff_account_id, since)

        ops_by_id: dict[str, Any] = {op.id: op for op in raw_ops}
        already_imported_ids = await self._get_already_imported_ids(raw_ops)

        resolutions_map = {r['tinkoff_op_id']: r for r in deposit_resolutions}

        applied_count = 0
        skipped_count = 0

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # 1. Process manual-decision operations (deposits/withdrawals)
                for op_id, resolution in resolutions_map.items():
                    if op_id in already_imported_ids:
                        skipped_count += 1
                        continue

                    op = ops_by_id.get(op_id)
                    if op is None:
                        continue

                    amount = float(_money_value_to_decimal(op.payment))
                    currency = op.currency.upper()
                    op_date = _op_date(op)
                    kind = resolution['resolution']
                    source_account_id = resolution.get('source_account_id')

                    await self._apply_deposit_resolution(
                        conn, user_id, linked_account_id, op_id,
                        amount, currency, op_date, kind, source_account_id,
                    )
                    applied_count += 1

                # 2. Process auto operations
                for op in raw_ops:
                    if op.id in already_imported_ids:
                        skipped_count += 1
                        continue
                    if op.id in resolutions_map:
                        continue  # already handled above

                    mapped = self._map_operation(op)
                    if mapped['kind'] in ('input', 'output'):
                        continue  # should have been in resolutions

                    await self._apply_auto_operation(
                        conn, user_id, linked_account_id, op, mapped,
                    )
                    applied_count += 1

                # 3. Update last_synced_at
                await conn.execute(
                    '''UPDATE budgeting.external_connections
                       SET last_synced_at = now()
                       WHERE id = $1''',
                    connection_id,
                )

        return {
            'status': 'ok',
            'applied': applied_count,
            'skipped_already_imported': skipped_count,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_connection(self, connection_id: int, user_id: int) -> dict:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                '''SELECT ec.*, u.id AS check_user_id
                   FROM budgeting.external_connections ec
                   JOIN budgeting.users u ON (
                       (ec.owner_type = 'user'   AND ec.owner_user_id = u.id)
                       OR
                       (ec.owner_type = 'family' AND ec.owner_family_id = (
                           SELECT family_id FROM budgeting.family_members
                           WHERE user_id = $2 LIMIT 1
                       ))
                   )
                   WHERE ec.id = $1 AND u.id = $2 AND ec.is_active = true''',
                connection_id, user_id,
            )
            if row is None:
                raise ValueError(f'Connection {connection_id} not found or not accessible')
            return dict(row)

    async def _get_sync_from(self, linked_account_id: int) -> Optional[datetime]:
        """
        Return the datetime to fetch operations from.
        Uses last_synced_at of the connection, or 1 year ago as default.
        """
        from datetime import timedelta
        return datetime.now(timezone.utc) - timedelta(days=365)

    async def _fetch_operations(
        self,
        token: str,
        tinkoff_account_id: str,
        since: Optional[datetime],
    ) -> list:
        """Fetch executed operations from Tinkoff Invest API."""
        from datetime import timedelta
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(days=365)

        to_dt = datetime.now(timezone.utc)

        async with AsyncClient(token) as client:
            response = await client.operations.get_operations(
                account_id=tinkoff_account_id,
                from_=since,
                to=to_dt,
                state=OperationState.OPERATION_STATE_EXECUTED,
            )
            return list(response.operations)

    def _map_operation(self, op) -> dict:
        """Map Tinkoff operation to our internal representation."""
        op_type_name = OperationType(op.operation_type).name if _SDK_AVAILABLE else str(op.operation_type)
        kind = _OP_TYPE_MAP.get(op_type_name, 'unknown')
        result: dict = {
            'kind': kind,
            'figi': op.figi or '',
        }
        # Try to get ticker from instrument FIGI (not available without extra call,
        # so we store FIGI and resolve later if needed)
        return result

    async def _get_already_imported_ids(self, raw_ops: list) -> set[str]:
        """Return set of tinkoff op IDs already recorded in our DB."""
        if not raw_ops:
            return set()

        op_ids = [op.id for op in raw_ops]
        async with self._pool.acquire() as conn:
            # Check portfolio_events
            pe_rows = await conn.fetch(
                '''SELECT external_id FROM budgeting.portfolio_events
                   WHERE import_source = 'tinkoff' AND external_id = ANY($1::text[])''',
                op_ids,
            )
            # Check bank_entries
            be_rows = await conn.fetch(
                '''SELECT external_id FROM budgeting.bank_entries
                   WHERE import_source = 'tinkoff' AND external_id = ANY($1::text[])''',
                op_ids,
            )
        return {row['external_id'] for row in pe_rows} | {row['external_id'] for row in be_rows}

    async def _find_or_create_position(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        linked_account_id: int,
        figi: str,
        ticker: str,
        currency: str,
    ) -> Optional[int]:
        """
        Find existing open position by FIGI/ticker in the investment account,
        or return None if not found (caller should create a new position).
        """
        row = await conn.fetchrow(
            '''SELECT pp.id
               FROM budgeting.portfolio_positions pp
               JOIN budgeting.bank_accounts ba ON ba.id = pp.investment_account_id
               WHERE pp.investment_account_id = $1
                 AND pp.status = 'open'
                 AND (pp.metadata->>'figi' = $2 OR pp.title = $3)
               LIMIT 1''',
            linked_account_id, figi, ticker,
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
        """Apply a single deposit resolution inside an existing transaction."""
        abs_amount = abs(amount)

        if resolution == 'external':
            # Record as broker_input: investment account +amount, no other account touched
            await conn.execute(
                '''SELECT budgeting.put__broker_cash_flow(
                    $1, $2, $3, $4, $5, $6, $7
                )''',
                user_id, linked_account_id, abs_amount, currency,
                op_date, 'broker_input', tinkoff_op_id,
            )

        elif resolution == 'transfer':
            # Transfer from source_account → investment account
            if source_account_id is None:
                raise ValueError('source_account_id required for transfer resolution')
            await conn.execute(
                '''SELECT budgeting.put__broker_transfer(
                    $1, $2, $3, $4, $5, $6
                )''',
                user_id, source_account_id, linked_account_id,
                abs_amount, currency, op_date,
            )
            # Mark in bank_entries
            await conn.execute(
                '''UPDATE budgeting.bank_entries
                   SET external_id = $1, import_source = 'tinkoff'
                   WHERE bank_account_id = $2
                     AND amount = $3
                     AND entry_date = $4
                     AND external_id IS NULL
                   LIMIT 1''',
                tinkoff_op_id, linked_account_id, abs_amount, op_date,
            )

        elif resolution == 'already_recorded':
            # Money is already in the investment account; just mark op as processed
            await conn.execute(
                '''INSERT INTO budgeting.bank_entries
                   (bank_account_id, amount, currency_code, entry_date,
                    entry_type, external_id, import_source, created_by_user_id)
                   VALUES ($1, $2, $3, $4, 'broker_input_ack', $5, 'tinkoff', $6)
                   ON CONFLICT DO NOTHING''',
                linked_account_id, abs_amount, currency, op_date,
                tinkoff_op_id, user_id,
            )

    async def _apply_auto_operation(
        self,
        conn: asyncpg.Connection,
        user_id: int,
        linked_account_id: int,
        op,
        mapped: dict,
    ) -> None:
        """Apply a single auto-classified operation (buy/sell/dividend/etc.)."""
        kind = mapped['kind']
        figi = mapped.get('figi', '')
        amount = float(abs(_money_value_to_decimal(op.payment)))
        currency = op.currency.upper()
        op_date = _op_date(op)
        quantity = float(op.quantity) if op.quantity else None
        op_id = op.id

        if kind == 'buy':
            pos_id = await self._find_or_create_position(
                conn, user_id, linked_account_id, figi, figi, currency
            )
            if pos_id is None:
                # Create new position
                result = await conn.fetchval(
                    '''SELECT budgeting.put__create_portfolio_position(
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )''',
                    user_id, linked_account_id, 'stock', figi,
                    quantity, amount, currency, op_date,
                    json.dumps({'figi': figi, 'import_source': 'tinkoff'}),
                )
                new_row = json.loads(result) if isinstance(result, str) else result
                pos_id = new_row.get('id') if new_row else None
                event_type = 'open'
            else:
                # Top up existing position
                await conn.execute(
                    '''SELECT budgeting.put__top_up_portfolio_position(
                        $1, $2, $3, $4, $5, $6
                    )''',
                    user_id, pos_id, amount, currency, quantity, op_date,
                )
                event_type = 'top_up'

            # Mark the latest event for this position with external_id
            await conn.execute(
                '''UPDATE budgeting.portfolio_events
                   SET external_id = $1, import_source = 'tinkoff'
                   WHERE position_id = $2
                     AND event_type = $3
                     AND external_id IS NULL
                   ORDER BY id DESC LIMIT 1''',
                op_id, pos_id, event_type,
            )

        elif kind in ('dividend', 'coupon'):
            pos_id = await self._find_or_create_position(
                conn, user_id, linked_account_id, figi, figi, currency
            )
            if pos_id:
                income_kind = 'dividend' if kind == 'dividend' else 'coupon'
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_income(
                        $1, $2, $3, $4, $5, $6, $7
                    )''',
                    user_id, pos_id, amount, currency, None, income_kind, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2 AND event_type = 'income'
                         AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
                )

        elif kind in ('broker_fee', 'tax'):
            pos_id = await self._find_or_create_position(
                conn, user_id, linked_account_id, figi, figi, currency
            )
            if pos_id:
                await conn.execute(
                    '''SELECT budgeting.put__record_portfolio_fee(
                        $1, $2, $3, $4, $5
                    )''',
                    user_id, pos_id, amount, currency, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2 AND event_type = 'fee'
                         AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
                )

        elif kind == 'sell':
            pos_id = await self._find_or_create_position(
                conn, user_id, linked_account_id, figi, figi, currency
            )
            if pos_id:
                # Partial or full close — we treat all sells as partial_close
                # The SQL function will decide if it's the last quantity
                await conn.execute(
                    '''SELECT budgeting.put__partial_close_portfolio_position(
                        $1, $2, $3, $4, $5, $6, $7
                    )''',
                    user_id, pos_id, amount, currency, amount, quantity, op_date,
                )
                await conn.execute(
                    '''UPDATE budgeting.portfolio_events
                       SET external_id = $1, import_source = 'tinkoff'
                       WHERE position_id = $2
                         AND event_type IN ('partial_close', 'close')
                         AND external_id IS NULL
                       ORDER BY id DESC LIMIT 1''',
                    op_id, pos_id,
                )


class TinkoffConnections:
    """CRUD for external_connections (provider='tinkoff')."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def get_accounts_from_token(self, token: str) -> list[dict]:
        """Call Tinkoff API and return list of accounts for the given token."""
        if not _SDK_AVAILABLE:
            raise RuntimeError('tinkoff-investments package is not installed')
        async with AsyncClient(token) as client:
            response = await client.users.get_accounts()
            return [
                {
                    'provider_account_id': acc.id,
                    'name': acc.name,
                    'type': acc.type.name,
                }
                for acc in response.accounts
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
                           SELECT family_id FROM budgeting.family_members
                           WHERE user_id = $1 LIMIT 1
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
            # Determine owner_type
            family_row = await conn.fetchrow(
                'SELECT family_id FROM budgeting.family_members WHERE user_id = $1 LIMIT 1',
                user_id,
            )
            if family_row:
                owner_type = 'family'
                owner_user_id = None
                owner_family_id = family_row['family_id']
            else:
                owner_type = 'user'
                owner_user_id = user_id
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
                           SELECT family_id FROM budgeting.family_members
                           WHERE user_id = $2 LIMIT 1
                       ))
                     )''',
                connection_id, user_id,
            )
            if result == 'UPDATE 0':
                raise ValueError(f'Connection {connection_id} not found or not accessible')
