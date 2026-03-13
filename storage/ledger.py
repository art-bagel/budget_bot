from typing import Optional

from storage.databases import DataBase


class Ledger(DataBase):
    SCHEMA = 'budgeting'

    F_PUT__RECORD_FX_RATE_SNAPSHOT = 'put__record_fx_rate_snapshot'
    F_PUT__RECORD_INCOME = 'put__record_income'
    F_PUT__ALLOCATE_BUDGET = 'put__allocate_budget'
    F_PUT__ALLOCATE_GROUP_BUDGET = 'put__allocate_group_budget'
    F_PUT__EXCHANGE_CURRENCY = 'put__exchange_currency'
    F_PUT__RECORD_EXPENSE = 'put__record_expense'
    F_PUT__REVERSE_OPERATION = 'put__reverse_operation'

    async def put__record_fx_rate_snapshot(
        self,
        base_currency_code: str,
        quote_currency_code: str,
        rate: float,
        fetched_at: Optional[str] = None,
        source: Optional[str] = None,
    ) -> int:
        """
        Сохраняет снимок валютного курса.
        :param base_currency_code: Целевая валюта оценки.
        :param quote_currency_code: Валюта, которая оценивается.
        :param rate: Количество базовой валюты за одну единицу оцениваемой валюты.
        :param fetched_at: Время получения курса.
        :param source: Источник курса.
        :return: Идентификатор созданного снимка курса.
        """
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_FX_RATE_SNAPSHOT),
            base_currency_code,
            quote_currency_code,
            rate,
            fetched_at,
            source,
        )

    async def put__record_income(
        self,
        user_id: int,
        bank_account_id: int,
        amount: float,
        currency_code: str,
        income_source_id: Optional[int] = None,
        budget_amount_in_base: Optional[float] = None,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Записывает доход в банк и в нераспределенный бюджет.
        :param user_id: Идентификатор владельца операции.
        :param bank_account_id: Идентификатор банковского счета.
        :param income_source_id: Идентификатор источника дохода.
        :param amount: Сумма дохода в валюте операции.
        :param currency_code: Код валюты дохода.
        :param budget_amount_in_base: Историческая стоимость в базовой валюте.
        :param comment: Комментарий к операции.
        :return: Словарь с идентификатором операции и суммой в базовой валюте.
        """
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_INCOME),
            user_id,
            bank_account_id,
            amount,
            currency_code,
            income_source_id,
            budget_amount_in_base,
            comment,
        )

    async def put__allocate_budget(
        self,
        user_id: int,
        from_category_id: int,
        to_category_id: int,
        amount_in_base: float,
        comment: Optional[str] = None,
    ) -> int:
        """
        Перемещает бюджет между категориями.
        :param user_id: Идентификатор владельца операции.
        :param from_category_id: Идентификатор категории-источника.
        :param to_category_id: Идентификатор категории-получателя.
        :param amount_in_base: Сумма в базовой валюте пользователя.
        :param comment: Комментарий к операции.
        :return: Идентификатор созданной операции.
        """
        return await self.call_function(
            self._fn(self.F_PUT__ALLOCATE_BUDGET),
            user_id,
            from_category_id,
            to_category_id,
            amount_in_base,
            comment,
        )

    async def put__allocate_group_budget(
        self,
        user_id: int,
        from_category_id: int,
        group_id: int,
        amount_in_base: float,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Распределяет бюджет по участникам группы.
        :param user_id: Идентификатор владельца операции.
        :param from_category_id: Идентификатор категории-источника.
        :param group_id: Идентификатор групповой категории.
        :param amount_in_base: Распределяемая сумма в базовой валюте.
        :param comment: Комментарий к операции.
        :return: Словарь с идентификатором операции и количеством участников.
        """
        return await self.call_function(
            self._fn(self.F_PUT__ALLOCATE_GROUP_BUDGET),
            user_id,
            from_category_id,
            group_id,
            amount_in_base,
            comment,
        )

    async def put__exchange_currency(
        self,
        user_id: int,
        bank_account_id: int,
        from_currency_code: str,
        from_amount: float,
        to_currency_code: str,
        to_amount: float,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Выполняет обмен валют внутри банка.
        :param user_id: Идентификатор владельца операции.
        :param bank_account_id: Идентификатор банковского счета.
        :param from_currency_code: Код продаваемой валюты.
        :param from_amount: Сумма продаваемой валюты.
        :param to_currency_code: Код покупаемой валюты.
        :param to_amount: Сумма покупаемой валюты.
        :param comment: Комментарий к операции.
        :return: Словарь с идентификатором операции, курсом и FX-результатом.
        """
        return await self.call_function(
            self._fn(self.F_PUT__EXCHANGE_CURRENCY),
            user_id,
            bank_account_id,
            from_currency_code,
            from_amount,
            to_currency_code,
            to_amount,
            comment,
        )

    async def put__record_expense(
        self,
        user_id: int,
        bank_account_id: int,
        category_id: int,
        amount: float,
        currency_code: str,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Записывает расход из банка на категорию.
        :param user_id: Идентификатор владельца операции.
        :param bank_account_id: Идентификатор банковского счета.
        :param category_id: Идентификатор бюджетной категории.
        :param amount: Сумма расхода в валюте операции.
        :param currency_code: Код валюты расхода.
        :param comment: Комментарий к операции.
        :return: Словарь с идентификатором операции и суммой в базовой валюте.
        """
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_EXPENSE),
            user_id,
            bank_account_id,
            category_id,
            amount,
            currency_code,
            comment,
        )

    F_PUT__TRANSFER_BETWEEN_ACCOUNTS = 'put__transfer_between_accounts'

    async def put__transfer_between_accounts(
        self,
        user_id: int,
        from_account_id: int,
        to_account_id: int,
        currency_code: str,
        amount: float,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Переводит деньги между банковскими счетами с сохранением исторической стоимости.
        :param user_id: Идентификатор пользователя, выполняющего перевод.
        :param from_account_id: Идентификатор счета-источника.
        :param to_account_id: Идентификатор счета-получателя.
        :param currency_code: Код валюты перевода.
        :param amount: Сумма перевода.
        :param comment: Комментарий к операции.
        :return: Словарь с идентификатором операции и суммой в базовой валюте.
        """
        return await self.call_function(
            self._fn(self.F_PUT__TRANSFER_BETWEEN_ACCOUNTS),
            user_id,
            from_account_id,
            to_account_id,
            currency_code,
            amount,
            comment,
        )

    async def put__reverse_operation(self, user_id: int, operation_id: int, comment: Optional[str] = None) -> dict:
        """
        Создает reversal для операции.
        :param user_id: Идентификатор владельца операции.
        :param operation_id: Идентификатор отменяемой операции.
        :param comment: Комментарий к reversal-операции.
        :return: Словарь с идентификатором reversal-операции и исходной операции.
        """
        return await self.call_function(
            self._fn(self.F_PUT__REVERSE_OPERATION),
            user_id,
            operation_id,
            comment,
        )
