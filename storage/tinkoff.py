import asyncpg

from storage.databases import DataBase


class TinkoffStorage(DataBase):
    SCHEMA = 'budgeting'

    F_GET__OWNER_BASE_CURRENCY = 'get__owner_base_currency'
    F_GET__TINKOFF_CONNECTIONS = 'get__tinkoff_connections'
    F_GET__TINKOFF_CONNECTION = 'get__tinkoff_connection'
    F_GET__TINKOFF_LIVE_PRICE_ROWS = 'get__tinkoff_live_price_rows'
    F_GET__TINKOFF_IMPORTED_IDS = 'get__tinkoff_imported_ids'
    F_GET__OPEN_PORTFOLIO_POSITIONS_FOR_ACCOUNT = 'get__open_portfolio_positions_for_account'
    F_GET__CURRENT_BANK_BALANCE_AMOUNT = 'get__current_bank_balance_amount'
    F_GET__PORTFOLIO_POSITION_TRADE_CONTEXT = 'get__portfolio_position_trade_context'
    F_PUT__UPSERT_TINKOFF_CONNECTION = 'put__upsert_tinkoff_connection'
    F_SET__DEACTIVATE_TINKOFF_CONNECTION = 'set__deactivate_tinkoff_connection'

    async def _call(self, func_name: str, *args, connection: asyncpg.Connection | None = None):
        func = self._fn(func_name)
        if connection is not None:
            return await self.call_function_with_connection(connection, func, *args)
        return await self.call_function(func, *args)

    async def get__owner_base_currency(
        self,
        owner_type: str,
        owner_user_id: int | None,
        owner_family_id: int | None,
        connection: asyncpg.Connection | None = None,
    ) -> str | None:
        return await self._call(
            self.F_GET__OWNER_BASE_CURRENCY,
            owner_type,
            owner_user_id,
            owner_family_id,
            connection=connection,
        )

    async def get__tinkoff_connections(self, user_id: int) -> list[dict]:
        result = await self._call(self.F_GET__TINKOFF_CONNECTIONS, user_id)
        return result if result else []

    async def get__tinkoff_connection(self, user_id: int, connection_id: int) -> dict | None:
        return await self._call(self.F_GET__TINKOFF_CONNECTION, user_id, connection_id)

    async def get__tinkoff_live_price_rows(self, user_id: int) -> list[dict]:
        result = await self._call(self.F_GET__TINKOFF_LIVE_PRICE_ROWS, user_id)
        return result if result else []

    async def get__tinkoff_imported_ids(
        self,
        external_ids: list[str],
        connection: asyncpg.Connection | None = None,
    ) -> set[str]:
        result = await self._call(
            self.F_GET__TINKOFF_IMPORTED_IDS,
            external_ids,
            connection=connection,
        )
        return set(result or [])

    async def get__open_portfolio_positions_for_account(
        self,
        investment_account_id: int,
        connection: asyncpg.Connection | None = None,
    ) -> list[dict]:
        result = await self._call(
            self.F_GET__OPEN_PORTFOLIO_POSITIONS_FOR_ACCOUNT,
            investment_account_id,
            connection=connection,
        )
        return result if result else []

    async def get__current_bank_balance_amount(
        self,
        bank_account_id: int,
        currency_code: str,
        connection: asyncpg.Connection | None = None,
    ) -> float:
        result = await self._call(
            self.F_GET__CURRENT_BANK_BALANCE_AMOUNT,
            bank_account_id,
            currency_code,
            connection=connection,
        )
        return float(result or 0)

    async def get__portfolio_position_trade_context(
        self,
        position_id: int,
        connection: asyncpg.Connection | None = None,
    ) -> dict | None:
        return await self._call(
            self.F_GET__PORTFOLIO_POSITION_TRADE_CONTEXT,
            position_id,
            connection=connection,
        )

    async def put__upsert_tinkoff_connection(
        self,
        user_id: int,
        token: str,
        provider_account_id: str,
        linked_account_id: int,
    ) -> dict:
        result = await self._call(
            self.F_PUT__UPSERT_TINKOFF_CONNECTION,
            user_id,
            token,
            provider_account_id,
            linked_account_id,
        )
        return result if result else {}

    async def set__deactivate_tinkoff_connection(self, connection_id: int, user_id: int) -> bool:
        return bool(await self._call(self.F_SET__DEACTIVATE_TINKOFF_CONNECTION, connection_id, user_id))
