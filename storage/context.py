from typing import List, Optional

from storage.databases import DataBase


class Context(DataBase):
    SCHEMA = 'budgeting'

    F_PUT__REGISTER_USER_CONTEXT = 'put__register_user_context'
    F_PUT__CREATE_CATEGORY = 'put__create_category'
    F_PUT__CREATE_INCOME_SOURCE = 'put__create_income_source'
    F_SET__UPDATE_CATEGORY = 'set__update_category'
    F_SET__ARCHIVE_CATEGORY = 'set__archive_category'
    F_SET__REPLACE_GROUP_MEMBERS = 'set__replace_group_members'
    F_SET__DELETE_USER_ACCOUNT = 'set__delete_user_account'
    F_SET__UPDATE_USER_SETTINGS = 'set__update_user_settings'

    async def put__register_user_context(
        self,
        user_id: int,
        base_currency_code: str,
        username: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
    ) -> dict:
        """
        Регистрирует пользователя, основной банковский счет и системные категории.
        :param user_id: Идентификатор пользователя.
        :param base_currency_code: Код базовой валюты пользователя.
        :param username: Username пользователя.
        :param first_name: Имя пользователя.
        :param last_name: Фамилия пользователя.
        :return: Словарь со статусом регистрации и идентификаторами созданных сущностей.
        """
        return await self.call_function(
            self._fn(self.F_PUT__REGISTER_USER_CONTEXT),
            user_id,
            base_currency_code,
            username,
            first_name,
            last_name,
        )

    async def put__create_category(self, user_id: int, name: str, kind: str) -> int:
        """
        Создает категорию.
        :param user_id: Идентификатор владельца категории.
        :param name: Имя категории.
        :param kind: Тип категории.
        :return: Идентификатор созданной категории.
        """
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_CATEGORY),
            user_id,
            name,
            kind,
        )

    async def put__create_income_source(self, user_id: int, name: str) -> int:
        """
        Создает источник дохода.
        :param user_id: Идентификатор владельца источника дохода.
        :param name: Имя источника дохода.
        :return: Идентификатор созданного источника дохода.
        """
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_INCOME_SOURCE),
            user_id,
            name,
        )

    async def set__update_category(self, user_id: int, category_id: int, name: str) -> dict:
        """
        Обновляет имя активной категории или группы.
        :param user_id: Идентификатор владельца категории.
        :param category_id: Идентификатор обновляемой категории.
        :param name: Новое имя категории.
        :return: Словарь с обновленными данными категории.
        """
        return await self.call_function(
            self._fn(self.F_SET__UPDATE_CATEGORY),
            user_id,
            category_id,
            name,
        )

    async def set__archive_category(self, user_id: int, category_id: int) -> dict:
        """
        Архивирует категорию или группу.
        :param user_id: Идентификатор владельца категории.
        :param category_id: Идентификатор архивируемой категории.
        :return: Словарь с идентификатором и типом архивированной категории.
        """
        return await self.call_function(
            self._fn(self.F_SET__ARCHIVE_CATEGORY),
            user_id,
            category_id,
        )

    async def set__replace_group_members(
        self,
        user_id: int,
        group_id: int,
        child_category_ids: List[int],
        shares: List[float],
    ) -> dict:
        """
        Полностью заменяет состав группы.
        :param user_id: Идентификатор владельца группы.
        :param group_id: Идентификатор групповой категории.
        :param child_category_ids: Идентификаторы дочерних категорий.
        :param shares: Доли распределения дочерних категорий.
        :return: Словарь с идентификатором группы и количеством участников.
        """
        return await self.call_function(
            self._fn(self.F_SET__REPLACE_GROUP_MEMBERS),
            user_id,
            group_id,
            child_category_ids,
            shares,
        )

    async def set__update_user_settings(self, user_id: int, hints_enabled: bool) -> dict:
        """
        Обновляет настройки интерфейса пользователя.
        :param user_id: Идентификатор пользователя.
        :param hints_enabled: Показывать ли подсказки жестов.
        :return: Словарь с обновлёнными настройками.
        """
        return await self.call_function(
            self._fn(self.F_SET__UPDATE_USER_SETTINGS),
            user_id,
            hints_enabled,
        )

    async def set__delete_user_account(self, user_id: int) -> dict:
        """
        Полностью удаляет пользователя и все связанные данные.
        :param user_id: Идентификатор удаляемого пользователя.
        :return: Словарь со статусом удаления и идентификатором пользователя.
        """
        return await self.call_function(
            self._fn(self.F_SET__DELETE_USER_ACCOUNT),
            user_id,
        )
