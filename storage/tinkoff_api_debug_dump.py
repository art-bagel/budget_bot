from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional

import asyncpg

from storage.tinkoff_sync import TinkoffRestClient, TinkoffSync


GET_ACCOUNTS_PATH = 'tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts'
GET_POSITIONS_PATH = 'tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions'
GET_PORTFOLIO_PATH = 'tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio'
GET_OPERATIONS_PATH = 'tinkoff.public.invest.api.contract.v1.OperationsService/GetOperationsByCursor'
GET_INSTRUMENT_BY_PATH = 'tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy'


@dataclass
class DumpStats:
    snapshots: int = 0
    items: int = 0
    connections: int = 0


async def _init_connection(connection: asyncpg.Connection) -> None:
    await connection.set_type_codec(
        'json',
        schema='pg_catalog',
        encoder=json.dumps,
        decoder=json.loads,
    )
    await connection.set_type_codec(
        'jsonb',
        schema='pg_catalog',
        encoder=json.dumps,
        decoder=json.loads,
        format='text',
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Dump raw T-Bank API payloads into debug tables.')
    parser.add_argument('--db-host', required=True)
    parser.add_argument('--db-port', type=int, required=True)
    parser.add_argument('--db-name', required=True)
    parser.add_argument('--db-user', required=True)
    parser.add_argument('--db-password', required=True)
    parser.add_argument('--connection-id', dest='connection_ids', action='append', type=int)
    parser.add_argument('--truncate', action='store_true', help='Clear previous debug dumps before writing new ones.')
    return parser.parse_args()


def _migration_sql_path() -> Path:
    return (
        Path(__file__).resolve().parent.parent
        / 'infra'
        / 'db'
        / 'Scripts'
        / 'budgeting'
        / 'migrations'
        / '019_tinkoff_api_debug_dump.sql'
    )


def _iso_to_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _item_at(payload: dict[str, Any]) -> Optional[datetime]:
    for key in (
        'date',
        'openedDate',
        'opened_date',
        'closedDate',
        'closed_date',
        'updatedAt',
        'updated_at',
        'lastBuyDate',
        'last_buy_date',
    ):
        item_at = _iso_to_datetime(payload.get(key))
        if item_at is not None:
            return item_at
    return None


def _external_id(payload: dict[str, Any]) -> Optional[str]:
    for key in (
        'id',
        'operationId',
        'operation_id',
        'positionUid',
        'position_uid',
        'instrumentUid',
        'instrument_uid',
        'uid',
        'figi',
        'ticker',
        'currency',
    ):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    nested_request = payload.get('request')
    if isinstance(nested_request, dict):
        nested_value = nested_request.get('id')
        if isinstance(nested_value, str) and nested_value.strip():
            return nested_value.strip()

    return None


def _list_payloads(response_payload: dict[str, Any], endpoint: str) -> Iterable[tuple[str, list[dict[str, Any]]]]:
    if endpoint == 'accounts':
        accounts = response_payload.get('accounts')
        if isinstance(accounts, list):
            yield ('account', [item for item in accounts if isinstance(item, dict)])
        return

    if endpoint == 'positions':
        for key, value in response_payload.items():
            if isinstance(value, list):
                yield (f'positions.{key}', [item for item in value if isinstance(item, dict)])
        return

    if endpoint == 'portfolio':
        positions = response_payload.get('positions')
        if isinstance(positions, list):
            yield ('portfolio.position', [item for item in positions if isinstance(item, dict)])
        return

    if endpoint == 'operations_page':
        items = response_payload.get('items')
        if isinstance(items, list):
            yield ('operation', [item for item in items if isinstance(item, dict)])
        return

    if endpoint == 'instruments':
        instruments = response_payload.get('items')
        if isinstance(instruments, list):
            yield ('instrument', [item for item in instruments if isinstance(item, dict)])


def _snapshot_count(response_payload: dict[str, Any], endpoint: str) -> int:
    total = 0
    for _item_type, items in _list_payloads(response_payload, endpoint):
        total += len(items)
    return total


async def _ensure_tables(conn: asyncpg.Connection) -> None:
    migration_sql = _migration_sql_path().read_text(encoding='utf-8')
    await conn.execute(migration_sql)


async def _truncate_tables(conn: asyncpg.Connection) -> None:
    await conn.execute('TRUNCATE budgeting.tinkoff_api_debug_items, budgeting.tinkoff_api_debug_snapshots RESTART IDENTITY')


async def _insert_snapshot(
    conn: asyncpg.Connection,
    connection_row: asyncpg.Record,
    endpoint: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
    requested_from: Optional[datetime] = None,
    requested_to: Optional[datetime] = None,
) -> int:
    return await conn.fetchval(
        '''INSERT INTO budgeting.tinkoff_api_debug_snapshots (
               connection_id,
               owner_user_id,
               owner_family_id,
               linked_account_id,
               provider_account_id,
               endpoint,
               requested_from,
               requested_to,
               request_payload,
               response_payload,
               record_count
           )
           VALUES (
               $1::bigint,
               $2::bigint,
               $3::bigint,
               $4::bigint,
               $5::varchar,
               $6::varchar,
               $7::timestamptz,
               $8::timestamptz,
               $9::jsonb,
               $10::jsonb,
               $11::integer
           )
           RETURNING id''',
        connection_row['id'],
        connection_row['owner_user_id'],
        connection_row['owner_family_id'],
        connection_row['linked_account_id'],
        connection_row['provider_account_id'],
        endpoint,
        requested_from,
        requested_to,
        request_payload,
        response_payload,
        _snapshot_count(response_payload, endpoint),
    )


async def _insert_items(
    conn: asyncpg.Connection,
    snapshot_id: int,
    connection_row: asyncpg.Record,
    endpoint: str,
    response_payload: dict[str, Any],
) -> int:
    rows: list[tuple[Any, ...]] = []

    for item_type, items in _list_payloads(response_payload, endpoint):
        for index, payload in enumerate(items):
            rows.append(
                (
                    snapshot_id,
                    connection_row['id'],
                    connection_row['linked_account_id'],
                    connection_row['provider_account_id'],
                    item_type,
                    _external_id(payload),
                    _item_at(payload),
                    index,
                    payload,
                )
            )

    if not rows:
        return 0

    await conn.executemany(
        '''INSERT INTO budgeting.tinkoff_api_debug_items (
               snapshot_id,
               connection_id,
               linked_account_id,
               provider_account_id,
               item_type,
               external_id,
               item_at,
               item_index,
               payload
           )
           VALUES (
               $1::bigint,
               $2::bigint,
               $3::bigint,
               $4::varchar,
               $5::varchar,
               $6::text,
               $7::timestamptz,
               $8::integer,
               $9::jsonb
           )''',
        rows,
    )
    return len(rows)


def _instrument_requests_from_payloads(*payload_groups: list[dict[str, Any]]) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    requests: list[tuple[str, str]] = []

    def add_request(id_type: str, instrument_id: Any) -> None:
        if not isinstance(instrument_id, str) or not instrument_id.strip():
            return
        key = (id_type, instrument_id.strip())
        if key in seen:
            return
        seen.add(key)
        requests.append(key)

    for payloads in payload_groups:
        for payload in payloads:
            add_request('INSTRUMENT_ID_TYPE_POSITION_UID', payload.get('positionUid') or payload.get('position_uid'))
            add_request('INSTRUMENT_ID_TYPE_UID', payload.get('instrumentUid') or payload.get('instrument_uid') or payload.get('uid'))
            add_request('INSTRUMENT_ID_TYPE_FIGI', payload.get('figi'))

    return requests


async def _dump_endpoint(
    conn: asyncpg.Connection,
    connection_row: asyncpg.Record,
    endpoint: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
    stats: DumpStats,
    requested_from: Optional[datetime] = None,
    requested_to: Optional[datetime] = None,
) -> None:
    snapshot_id = await _insert_snapshot(
        conn,
        connection_row,
        endpoint,
        request_payload,
        response_payload,
        requested_from=requested_from,
        requested_to=requested_to,
    )
    stats.snapshots += 1
    stats.items += await _insert_items(conn, snapshot_id, connection_row, endpoint, response_payload)


async def _dump_connection(
    conn: asyncpg.Connection,
    connection_row: asyncpg.Record,
    client: TinkoffRestClient,
    sync: TinkoffSync,
    stats: DumpStats,
) -> None:
    provider_account_id = connection_row['provider_account_id']

    accounts_request: dict[str, Any] = {}
    accounts_response = await client._post(GET_ACCOUNTS_PATH, accounts_request)
    await _dump_endpoint(conn, connection_row, 'accounts', accounts_request, accounts_response, stats)

    positions_request = {'accountId': provider_account_id}
    positions_response = await client._post(GET_POSITIONS_PATH, positions_request)
    await _dump_endpoint(conn, connection_row, 'positions', positions_request, positions_response, stats)

    portfolio_request = {'accountId': provider_account_id, 'currency': 'RUB'}
    portfolio_response = await client._post(GET_PORTFOLIO_PATH, portfolio_request)
    await _dump_endpoint(conn, connection_row, 'portfolio', portfolio_request, portfolio_response, stats)

    since = await sync._get_since(client, provider_account_id, conn_row=dict(connection_row))
    requested_to = datetime.now().astimezone()
    cursor = ''
    operations_payloads: list[dict[str, Any]] = []
    page_index = 0

    while True:
        operations_request: dict[str, Any] = {
            'accountId': provider_account_id,
            'from': since.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'to': requested_to.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'state': 'OPERATION_STATE_EXECUTED',
            'limit': 1000,
        }
        if cursor:
            operations_request['cursor'] = cursor

        operations_response = await client._post(GET_OPERATIONS_PATH, operations_request)
        await _dump_endpoint(
            conn,
            connection_row,
            'operations_page',
            operations_request,
            operations_response,
            stats,
            requested_from=since,
            requested_to=requested_to,
        )

        items = operations_response.get('items')
        if isinstance(items, list):
            operations_payloads.extend(item for item in items if isinstance(item, dict))

        page_index += 1
        if not operations_response.get('hasNext') or not items:
            break

        cursor = operations_response.get('nextCursor', '')
        if not cursor:
            break

    position_securities = [
        item for item in positions_response.get('securities', [])
        if isinstance(item, dict)
    ] if isinstance(positions_response.get('securities'), list) else []
    portfolio_positions = [
        item for item in portfolio_response.get('positions', [])
        if isinstance(item, dict)
    ] if isinstance(portfolio_response.get('positions'), list) else []

    instrument_requests = _instrument_requests_from_payloads(
        operations_payloads,
        position_securities,
        portfolio_positions,
    )

    instrument_items: list[dict[str, Any]] = []
    for id_type, instrument_id in instrument_requests:
        request_payload = {
            'idType': id_type,
            'id': instrument_id,
        }
        try:
            response_payload = await client._post(GET_INSTRUMENT_BY_PATH, request_payload)
            instrument_items.append({
                'request': request_payload,
                'response': response_payload,
            })
        except Exception as exc:
            instrument_items.append({
                'request': request_payload,
                'error': str(exc),
            })

    await _dump_endpoint(
        conn,
        connection_row,
        'instruments',
        {'count': len(instrument_requests)},
        {'items': instrument_items},
        stats,
    )


async def _load_connections(conn: asyncpg.Connection, connection_ids: Optional[list[int]]) -> list[asyncpg.Record]:
    if connection_ids:
        return await conn.fetch(
            '''SELECT *
               FROM budgeting.external_connections
               WHERE provider = 'tinkoff'
                 AND is_active
                 AND id = ANY($1::bigint[])
               ORDER BY id''',
            connection_ids,
        )

    return await conn.fetch(
        '''SELECT *
           FROM budgeting.external_connections
           WHERE provider = 'tinkoff'
             AND is_active
           ORDER BY id'''
    )


async def main() -> None:
    args = _parse_args()
    pool = await asyncpg.create_pool(
        host=args.db_host,
        port=args.db_port,
        database=args.db_name,
        user=args.db_user,
        password=args.db_password,
        min_size=1,
        max_size=5,
        init=_init_connection,
    )
    stats = DumpStats()
    sync = TinkoffSync(pool)

    try:
        async with pool.acquire() as conn:
            await _ensure_tables(conn)
            if args.truncate:
                await _truncate_tables(conn)
            connection_rows = await _load_connections(conn, args.connection_ids)

        if not connection_rows:
            print('No active T-Bank connections found.')
            return

        for connection_row in connection_rows:
            creds = connection_row['credentials']
            if isinstance(creds, str):
                creds = json.loads(creds)

            token = creds.get('token')
            if not token:
                print(f"Skipping connection {connection_row['id']}: token is missing.")
                continue

            stats.connections += 1
            print(
                f"Dumping connection {connection_row['id']} "
                f"(provider_account_id={connection_row['provider_account_id']}, "
                f"linked_account_id={connection_row['linked_account_id']})"
            )

            client = TinkoffRestClient(token)
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await _dump_connection(conn, connection_row, client, sync, stats)

        print(
            f'Finished. Connections={stats.connections}, '
            f'snapshots={stats.snapshots}, items={stats.items}.'
        )
    finally:
        await pool.close()


if __name__ == '__main__':
    asyncio.run(main())
