import json
from datetime import date
from typing import Any, Optional

from storage.databases import DataBase


class Reports(DataBase):
    SCHEMA = 'budgeting'

    F_GET__CURRENCIES = 'get__currencies'
    F_GET__BANK_ACCOUNTS = 'get__bank_accounts'
    F_GET__MY_FAMILY = 'get__my_family'
    F_GET__FAMILY_MEMBERS = 'get__family_members'
    F_GET__FAMILY_INVITATIONS = 'get__family_invitations'
    F_GET__CATEGORIES = 'get__categories'
    F_GET__INCOME_SOURCES = 'get__income_sources'
    F_GET__GROUP_MEMBERS = 'get__group_members'
    F_GET__CATEGORY_PARENT_GROUPS = 'get__category_parent_groups'
    F_GET__BANK_SNAPSHOT = 'get__bank_snapshot'
    F_GET__BUDGET_SNAPSHOT = 'get__budget_snapshot'
    F_GET__OPERATIONS_HISTORY = 'get__operations_history'
    F_GET__OPERATIONS_ANALYTICS = 'get__operations_analytics'
    F_GET__PORTFOLIO_VALUATION = 'get__portfolio_valuation'
    F_GET__PORTFOLIO_SUMMARY = 'get__portfolio_summary'
    F_GET__PORTFOLIO_POSITION = 'get__portfolio_position'
    F_GET__PORTFOLIO_POSITIONS = 'get__portfolio_positions'
    F_GET__PORTFOLIO_EVENTS = 'get__portfolio_events'

    @staticmethod
    def _repair_metadata(value: dict) -> dict:
        normalized = dict(value)
        class_code = str(normalized.get('class_code', '')).upper().strip()
        exchange = str(normalized.get('exchange', '')).upper().strip()
        instrument_type = str(normalized.get('instrument_type', '')).lower().strip()
        security_kind = str(normalized.get('security_kind', '')).lower().strip()

        is_bond = (
            security_kind == 'bond'
            or str(normalized.get('moex_market', '')).lower().strip() == 'bonds'
            or class_code.startswith('TQO')
            or class_code == 'TQCB'
            or 'bond' in instrument_type
            or 'BOND' in exchange
        )

        if is_bond:
            normalized['security_kind'] = 'bond'
            normalized['moex_market'] = 'bonds'

        return normalized

    @staticmethod
    def _normalize_metadata(value: Any) -> dict:
        if isinstance(value, dict):
            return Reports._repair_metadata(value)

        if isinstance(value, list):
            merged: dict = {}
            for item in value:
                merged.update(Reports._normalize_metadata(item))
            return Reports._repair_metadata(merged)

        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return Reports._normalize_metadata(parsed)

        return {}

    async def get__currencies(self) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__CURRENCIES),
        )
        return result if result else []

    async def get__bank_accounts(
        self,
        user_id: int,
        is_active: Optional[bool] = True,
        account_kind: Optional[str] = 'cash',
    ) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__BANK_ACCOUNTS),
            user_id,
            is_active,
            account_kind,
        )
        return result if result else []

    async def get__my_family(self, user_id: int) -> Optional[dict]:
        return await self.call_function(
            self._fn(self.F_GET__MY_FAMILY),
            user_id,
        )

    async def get__family_members(self, user_id: int) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__FAMILY_MEMBERS),
            user_id,
        )
        return result if result else []

    async def get__family_invitations(self, user_id: int) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__FAMILY_INVITATIONS),
            user_id,
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

    async def get__category_parent_groups(self, user_id: int, category_id: int) -> list[dict]:
        """
        Возвращает активные родительские группы, в которые входит категория или группа.
        :param user_id: Идентификатор владельца категории.
        :param category_id: Идентификатор категории или группы.
        :return: Список словарей с родительскими группами.
        """
        result = await self.call_function(
            self._fn(self.F_GET__CATEGORY_PARENT_GROUPS),
            user_id,
            category_id,
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

    async def get__operations_history(
        self,
        user_id: int,
        limit: int = 20,
        offset: int = 0,
        operation_type: Optional[str] = None,
    ) -> dict:
        """
        Возвращает историю операций пользователя.
        :param user_id: Идентификатор владельца операций.
        :param limit: Количество операций в выборке.
        :param offset: Смещение от начала истории.
        :param operation_type: Тип операции для фильтрации истории.
        :return: Словарь с массивом операций и параметрами пагинации.
        """
        result = await self.call_function(
            self._fn(self.F_GET__OPERATIONS_HISTORY),
            user_id,
            limit,
            offset,
            operation_type,
        )
        return result if result else {
            'items': [],
            'total_count': 0,
            'limit': limit,
            'offset': offset,
        }

    async def get__operations_analytics(
        self,
        user_id: int,
        anchor_date: Optional[date] = None,
        period_mode: str = 'month',
        operation_type: str = 'expense',
        owner_scope: str = 'all',
        periods: int = 6,
    ) -> dict:
        """
        Возвращает аналитику операций по выбранному месяцу и динамику по месяцам.
        :param user_id: Идентификатор владельца операций.
        :param anchor_date: Дата внутри выбранного периода.
        :param period_mode: Режим периода: week, month, year.
        :param operation_type: Тип аналитики: income или expense.
        :param owner_scope: Область владельца: all, user, family.
        :param periods: Количество периодов в динамике, включая выбранный.
        :return: Словарь с разбивкой по категориям/источникам и помесячной серией.
        """
        result = await self.call_function(
            self._fn(self.F_GET__OPERATIONS_ANALYTICS),
            user_id,
            anchor_date,
            period_mode,
            operation_type,
            owner_scope,
            periods,
        )
        return result if result else {
            'period_start': anchor_date,
            'period_mode': period_mode,
            'operation_type': operation_type,
            'owner_scope': owner_scope,
            'base_currency_code': '',
            'has_family': False,
            'total_amount': 0,
            'total_operations': 0,
            'items': [],
            'periods': [],
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

    async def get__portfolio_summary(
        self,
        user_id: int,
    ) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__PORTFOLIO_SUMMARY),
            user_id,
        )
        return result if result else []

    async def get__portfolio_position(
        self,
        user_id: int,
        position_id: int,
    ) -> Optional[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__PORTFOLIO_POSITION),
            user_id,
            position_id,
        )
        if result:
            result['metadata'] = self._normalize_metadata(result.get('metadata'))
        return result

    async def get__portfolio_positions(
        self,
        user_id: int,
        status: Optional[str] = None,
        investment_account_id: Optional[int] = None,
    ) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__PORTFOLIO_POSITIONS),
            user_id,
            status,
            investment_account_id,
        )
        if not result:
            return []
        for item in result:
            item['metadata'] = self._normalize_metadata(item.get('metadata'))
        return result

    async def get__portfolio_events(
        self,
        user_id: int,
        position_id: int,
    ) -> list[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__PORTFOLIO_EVENTS),
            user_id,
            position_id,
        )
        if not result:
            return []
        for item in result:
            item['metadata'] = self._normalize_metadata(item.get('metadata'))
        return result
