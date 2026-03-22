from typing import List, Optional

from storage.databases import DataBase


class Context(DataBase):
    SCHEMA = 'budgeting'

    F_PUT__REGISTER_USER_CONTEXT = 'put__register_user_context'
    F_PUT__CREATE_FAMILY = 'put__create_family'
    F_PUT__CREATE_BANK_ACCOUNT = 'put__create_bank_account'
    F_PUT__CREATE_CREDIT_ACCOUNT = 'put__create_credit_account'
    F_PUT__CREATE_PORTFOLIO_POSITION = 'put__create_portfolio_position'
    F_PUT__TOP_UP_PORTFOLIO_POSITION = 'put__top_up_portfolio_position'
    F_PUT__PARTIAL_CLOSE_PORTFOLIO_POSITION = 'put__partial_close_portfolio_position'
    F_PUT__CLOSE_PORTFOLIO_POSITION = 'put__close_portfolio_position'
    F_PUT__RECORD_PORTFOLIO_FEE = 'put__record_portfolio_fee'
    F_PUT__DELETE_PORTFOLIO_POSITION = 'put__delete_portfolio_position'
    F_PUT__CANCEL_PORTFOLIO_INCOME = 'put__cancel_portfolio_income'
    F_PUT__INVITE_FAMILY_MEMBER = 'put__invite_family_member'
    F_PUT__CREATE_CATEGORY = 'put__create_category'
    F_PUT__CREATE_INCOME_SOURCE = 'put__create_income_source'
    F_SET__UPDATE_CATEGORY = 'set__update_category'
    F_SET__ARCHIVE_CATEGORY = 'set__archive_category'
    F_SET__RESPOND_FAMILY_INVITATION = 'set__respond_family_invitation'
    F_SET__REPLACE_GROUP_MEMBERS = 'set__replace_group_members'
    F_SET__DELETE_USER_ACCOUNT = 'set__delete_user_account'
    F_SET__UPDATE_USER_SETTINGS = 'set__update_user_settings'
    F_SET__LEAVE_FAMILY = 'set__leave_family'
    F_SET__DISSOLVE_FAMILY = 'set__dissolve_family'
    F_SET__ARCHIVE_CREDIT_ACCOUNT = 'set__archive_credit_account'

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

    async def put__create_family(self, user_id: int, name: Optional[str] = None) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_FAMILY),
            user_id,
            name,
        )

    async def put__create_bank_account(
        self,
        user_id: int,
        name: str,
        owner_type: str = 'user',
        account_kind: str = 'investment',
        investment_asset_type: Optional[str] = None,
        provider_name: Optional[str] = None,
        provider_account_ref: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_BANK_ACCOUNT),
            user_id,
            name,
            owner_type,
            account_kind,
            investment_asset_type,
            provider_name,
            provider_account_ref,
        )

    async def put__create_credit_account(
        self,
        user_id: int,
        name: str,
        credit_kind: str,
        currency_code: str,
        credit_limit: float,
        target_account_id: Optional[int] = None,
        owner_type: str = 'user',
        interest_rate: Optional[float] = None,
        payment_day: Optional[int] = None,
        credit_started_at=None,
        credit_ends_at=None,
        provider_name: Optional[str] = None,
        provider_account_ref: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_CREDIT_ACCOUNT),
            user_id,
            name,
            credit_kind,
            currency_code,
            credit_limit,
            target_account_id,
            owner_type,
            interest_rate,
            payment_day,
            credit_started_at,
            credit_ends_at,
            provider_name,
            provider_account_ref,
        )

    async def set__archive_credit_account(self, user_id: int, bank_account_id: int) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__ARCHIVE_CREDIT_ACCOUNT),
            user_id,
            bank_account_id,
        )

    async def put__invite_family_member(self, user_id: int, username: str) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__INVITE_FAMILY_MEMBER),
            user_id,
            username,
        )

    async def put__create_portfolio_position(
        self,
        user_id: int,
        investment_account_id: int,
        asset_type_code: str,
        title: str,
        quantity: Optional[float] = None,
        amount_in_currency: float = 0,
        currency_code: str = '',
        opened_at: Optional[str] = None,
        comment: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_PORTFOLIO_POSITION),
            user_id,
            investment_account_id,
            asset_type_code,
            title,
            quantity,
            amount_in_currency,
            currency_code,
            opened_at,
            comment,
            metadata,
        )

    async def put__top_up_portfolio_position(
        self,
        user_id: int,
        position_id: int,
        amount_in_currency: float,
        currency_code: str,
        quantity: Optional[float] = None,
        topped_up_at: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__TOP_UP_PORTFOLIO_POSITION),
            user_id,
            position_id,
            amount_in_currency,
            currency_code,
            quantity,
            topped_up_at,
            comment,
        )

    async def put__close_portfolio_position(
        self,
        user_id: int,
        position_id: int,
        close_amount_in_currency: float,
        close_currency_code: str,
        close_amount_in_base: Optional[float] = None,
        closed_at: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CLOSE_PORTFOLIO_POSITION),
            user_id,
            position_id,
            close_amount_in_currency,
            close_currency_code,
            close_amount_in_base,
            closed_at,
            comment,
        )

    async def put__partial_close_portfolio_position(
        self,
        user_id: int,
        position_id: int,
        return_amount_in_currency: float,
        return_currency_code: str,
        principal_reduction_in_currency: float,
        return_amount_in_base: Optional[float] = None,
        closed_quantity: Optional[float] = None,
        closed_at: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__PARTIAL_CLOSE_PORTFOLIO_POSITION),
            user_id,
            position_id,
            return_amount_in_currency,
            return_currency_code,
            principal_reduction_in_currency,
            return_amount_in_base,
            closed_quantity,
            closed_at,
            comment,
        )

    async def put__record_portfolio_fee(
        self,
        user_id: int,
        position_id: int,
        amount: float,
        currency_code: str,
        charged_at: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_PORTFOLIO_FEE),
            user_id,
            position_id,
            amount,
            currency_code,
            charged_at,
            comment,
        )

    async def put__delete_portfolio_position(
        self,
        user_id: int,
        position_id: int,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__DELETE_PORTFOLIO_POSITION),
            user_id,
            position_id,
            comment,
        )

    async def put__cancel_portfolio_income(
        self,
        user_id: int,
        event_id: int,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CANCEL_PORTFOLIO_INCOME),
            user_id,
            event_id,
            comment,
        )

    async def put__create_category(
        self,
        user_id: int,
        name: str,
        kind: str,
        owner_type: str = 'user',
    ) -> int:
        """
        Создает категорию.
        :param user_id: Идентификатор владельца категории.
        :param name: Имя категории.
        :param kind: Тип категории.
        :param owner_type: Владелец категории: user или family.
        :return: Идентификатор созданной категории.
        """
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_CATEGORY),
            user_id,
            name,
            kind,
            owner_type,
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

    async def set__respond_family_invitation(self, user_id: int, invitation_id: int, accept: bool) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__RESPOND_FAMILY_INVITATION),
            user_id,
            invitation_id,
            accept,
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

    async def set__update_user_settings(
        self,
        user_id: int,
        hints_enabled: Optional[bool] = None,
        theme: Optional[str] = None,
    ) -> dict:
        """
        Обновляет настройки интерфейса пользователя.
        :param user_id: Идентификатор пользователя.
        :param hints_enabled: Показывать ли подсказки жестов (None = не менять).
        :param theme: Тема интерфейса: 'light', 'dark', 'system' (None = не менять).
        :return: Словарь с обновлёнными настройками.
        """
        return await self.call_function(
            self._fn(self.F_SET__UPDATE_USER_SETTINGS),
            user_id,
            hints_enabled,
            theme,
        )

    async def set__leave_family(self, user_id: int) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__LEAVE_FAMILY),
            user_id,
        )

    async def set__dissolve_family(self, user_id: int) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__DISSOLVE_FAMILY),
            user_id,
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
