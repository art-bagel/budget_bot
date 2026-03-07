from typing import Optional

from storage.databases import DataBase


class Reports(DataBase):
    SCHEMA = 'budgeting'

    F_GET__CURRENCIES = 'get__currencies'
    F_GET__CATEGORIES = 'get__categories'
    F_GET__INCOME_SOURCES = 'get__income_sources'
    F_GET__GROUP_MEMBERS = 'get__group_members'
    F_GET__BANK_SNAPSHOT = 'get__bank_snapshot'
    F_GET__BUDGET_SNAPSHOT = 'get__budget_snapshot'
    F_GET__OPERATIONS_HISTORY = 'get__operations_history'
    F_GET__PORTFOLIO_VALUATION = 'get__portfolio_valuation'

    async def get__currencies(self) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__CURRENCIES),
        )
        return result if result else []

    async def get__categories(self, user_id: int, is_active: Optional[bool] = True) -> list[dict]:
        """
        Возвращает категории пользователя.
        :param user_id: Идентификатор владельца категорий.
        :param is_active: Признак активности категорий.
        :return: Список словарей с категориями.
        """
        result = await self.call_function(
            self._fn(self.F_GET__CATEGORIES),
            user_id,
            is_active,
        )
        return result if result else []

    async def get__income_sources(self, user_id: int, is_active: Optional[bool] = True) -> list[dict]:
        """
        Возвращает источники дохода пользователя.
        :param user_id: Идентификатор владельца источников дохода.
        :param is_active: Признак активности источников дохода.
        :return: Список словарей с источниками дохода.
        """
        result = await self.call_function(
            self._fn(self.F_GET__INCOME_SOURCES),
            user_id,
            is_active,
        )
        return result if result else []

    async def get__group_members(self, user_id: int, group_id: int) -> list[dict]:
        """
        Возвращает участников группы.
        :param user_id: Идентификатор владельца группы.
        :param group_id: Идентификатор групповой категории.
        :return: Список словарей с участниками группы и их долями.
        """
        result = await self.call_function(
            self._fn(self.F_GET__GROUP_MEMBERS),
            user_id,
            group_id,
        )
        return result if result else []

    async def get__bank_snapshot(self, user_id: int, bank_account_id: int) -> list[dict]:
        """
        Возвращает снимок банка.
        :param user_id: Идентификатор владельца счета.
        :param bank_account_id: Идентификатор банковского счета.
        :return: Список словарей с остатками банка.
        """
        result = await self.call_function(
            self._fn(self.F_GET__BANK_SNAPSHOT),
            user_id,
            bank_account_id,
        )
        return result if result else []

    async def get__budget_snapshot(self, user_id: int, is_active: Optional[bool] = True) -> list[dict]:
        """
        Возвращает бюджетные остатки по категориям.
        :param user_id: Идентификатор владельца бюджета.
        :param is_active: Признак активности категорий.
        :return: Список словарей с бюджетами категорий.
        """
        result = await self.call_function(
            self._fn(self.F_GET__BUDGET_SNAPSHOT),
            user_id,
            is_active,
        )
        return result if result else []

    async def get__operations_history(self, user_id: int, limit: int = 20, offset: int = 0) -> dict:
        """
        Возвращает историю операций пользователя.
        :param user_id: Идентификатор владельца операций.
        :param limit: Количество операций в выборке.
        :param offset: Смещение от начала истории.
        :return: Словарь с массивом операций и параметрами пагинации.
        """
        result = await self.call_function(
            self._fn(self.F_GET__OPERATIONS_HISTORY),
            user_id,
            limit,
            offset,
        )
        return result if result else {
            'items': [],
            'total_count': 0,
            'limit': limit,
            'offset': offset,
        }

    async def get__portfolio_valuation(
        self,
        user_id: int,
        bank_account_id: int,
        target_currency_code: str,
        as_of: Optional[str] = None,
    ) -> dict:
        """
        Возвращает оценку банка в запрошенной валюте.
        :param user_id: Идентификатор владельца счета.
        :param bank_account_id: Идентификатор банковского счета.
        :param target_currency_code: Код валюты оценки.
        :param as_of: Верхняя граница по времени для курсов.
        :return: Словарь с деталями оценки и итоговой суммой.
        """
        return await self.call_function(
            self._fn(self.F_GET__PORTFOLIO_VALUATION),
            user_id,
            bank_account_id,
            target_currency_code,
            as_of,
        )
