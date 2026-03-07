from typing import List, Optional

from storage.databases import DataBase


class Context(DataBase):
    SCHEMA = 'budgeting'

    F_PUT__REGISTER_USER_CONTEXT = 'put__register_user_context'
    F_PUT__CREATE_CATEGORY = 'put__create_category'
    F_SET__REPLACE_GROUP_MEMBERS = 'set__replace_group_members'

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
