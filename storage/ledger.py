from datetime import date
from typing import Optional

from storage.databases import DataBase


class Ledger(DataBase):
    SCHEMA = 'budgeting'

    F_PUT__RECORD_FX_RATE_SNAPSHOT = 'put__record_fx_rate_snapshot'
    F_PUT__RECORD_INCOME = 'put__record_income'
    F_PUT__RECORD_PORTFOLIO_INCOME = 'put__record_portfolio_income'
    F_PUT__ALLOCATE_BUDGET = 'put__allocate_budget'
    F_PUT__ALLOCATE_GROUP_BUDGET = 'put__allocate_group_budget'
    F_PUT__EXCHANGE_CURRENCY = 'put__exchange_currency'
    F_PUT__RECORD_EXPENSE = 'put__record_expense'
    F_PUT__UPSERT_CRYPTO_ASSET = 'put__upsert_crypto_asset'
    F_PUT__BUY_CRYPTO_ASSET = 'put__buy_crypto_asset'
    F_PUT__SELL_CRYPTO_ASSET = 'put__sell_crypto_asset'
    F_PUT__RECORD_CRYPTO_EXPENSE = 'put__record_crypto_expense'
    F_PUT__TRANSFER_CRYPTO_TO_INVESTMENT = 'put__transfer_crypto_to_investment'
    F_PUT__TRANSFER_CRYPTO_FROM_INVESTMENT = 'put__transfer_crypto_from_investment'
    F_PUT__TRANSFER_CRYPTO_BETWEEN_INVESTMENT_ACCOUNTS = 'put__transfer_crypto_between_investment_accounts'
    F_PUT__SWAP_CRYPTO_INVESTMENT_ASSET = 'put__swap_crypto_investment_asset'
    F_PUT__CREATE_CRYPTO_PROTOCOL_POSITION = 'put__create_crypto_protocol_position'
    F_SET__UPDATE_CRYPTO_PROTOCOL_POSITION = 'set__update_crypto_protocol_position'
    F_SET__CLOSE_CRYPTO_PROTOCOL_POSITION = 'set__close_crypto_protocol_position'
    F_PUT__PARTIAL_CLOSE_CRYPTO_PROTOCOL_POSITION = 'put__partial_close_crypto_protocol_position'
    F_PUT__TOP_UP_CRYPTO_PROTOCOL_POSITION = 'put__top_up_crypto_protocol_position'
    F_PUT__LENDING_TAKE_MORE_DEBT = 'put__lending_take_more_debt'
    F_PUT__LENDING_REPAY_DEBT = 'put__lending_repay_debt'
    F_PUT__CRYPTO_PAY_FEE = 'put__crypto_pay_fee'
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
        operated_at: Optional[date] = None,
        tax_percent: Optional[float] = None,
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
        :param operated_at: Дата операции (ISO-формат). По умолчанию — текущая дата.
        :param tax_percent: Процент налога, который надо списать после записи дохода.
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
            operated_at,
            tax_percent,
        )

    async def put__record_portfolio_income(
        self,
        user_id: int,
        position_id: int,
        amount: float,
        currency_code: str,
        amount_in_base: Optional[float] = None,
        quantity: Optional[float] = None,
        income_kind: Optional[str] = None,
        received_at: Optional[str] = None,
        comment: Optional[str] = None,
        destination: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_PORTFOLIO_INCOME),
            user_id,
            position_id,
            amount,
            currency_code,
            amount_in_base,
            income_kind,
            received_at,
            comment,
            None,
            destination,
            quantity,
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
        operated_at: Optional[date] = None,
    ) -> dict:
        """
        Записывает расход из банка на категорию.
        :param user_id: Идентификатор владельца операции.
        :param bank_account_id: Идентификатор банковского счета.
        :param category_id: Идентификатор бюджетной категории.
        :param amount: Сумма расхода в валюте операции.
        :param currency_code: Код валюты расхода.
        :param comment: Комментарий к операции.
        :param operated_at: Дата операции. По умолчанию — текущая дата.
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
            operated_at,
        )

    async def put__upsert_crypto_asset(
        self,
        symbol: str,
        name: Optional[str] = None,
        network_code: Optional[str] = None,
        contract_address: Optional[str] = None,
        decimals: int = 8,
        metadata: Optional[dict] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__UPSERT_CRYPTO_ASSET),
            symbol,
            name,
            network_code,
            contract_address,
            decimals,
            metadata or {},
        )

    async def put__buy_crypto_asset(
        self,
        user_id: int,
        bank_account_id: int,
        fiat_currency_code: str,
        fiat_amount: float,
        crypto_asset_id: int,
        crypto_amount: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__BUY_CRYPTO_ASSET),
            user_id,
            bank_account_id,
            fiat_currency_code,
            fiat_amount,
            crypto_asset_id,
            crypto_amount,
            comment,
            operated_at,
        )

    async def put__sell_crypto_asset(
        self,
        user_id: int,
        bank_account_id: int,
        crypto_asset_id: int,
        crypto_amount: float,
        fiat_currency_code: str,
        fiat_amount: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__SELL_CRYPTO_ASSET),
            user_id,
            bank_account_id,
            crypto_asset_id,
            crypto_amount,
            fiat_currency_code,
            fiat_amount,
            comment,
            operated_at,
        )

    async def put__record_crypto_expense(
        self,
        user_id: int,
        bank_account_id: int,
        category_id: int,
        crypto_asset_id: int,
        amount: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_CRYPTO_EXPENSE),
            user_id,
            bank_account_id,
            category_id,
            crypto_asset_id,
            amount,
            comment,
            operated_at,
        )

    async def put__transfer_crypto_to_investment(
        self,
        user_id: int,
        bank_account_id: int,
        investment_account_id: int,
        crypto_asset_id: int,
        amount: float,
        position_id: Optional[int] = None,
        title: Optional[str] = None,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__TRANSFER_CRYPTO_TO_INVESTMENT),
            user_id,
            bank_account_id,
            investment_account_id,
            crypto_asset_id,
            amount,
            position_id,
            title,
            comment,
            operated_at,
        )

    async def put__transfer_crypto_from_investment(
        self,
        user_id: int,
        position_id: int,
        bank_account_id: int,
        amount: float,
        value_in_base: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__TRANSFER_CRYPTO_FROM_INVESTMENT),
            user_id,
            position_id,
            bank_account_id,
            amount,
            value_in_base,
            comment,
            operated_at,
        )

    async def put__transfer_crypto_between_investment_accounts(
        self,
        user_id: int,
        position_id: int,
        target_investment_account_id: int,
        amount: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__TRANSFER_CRYPTO_BETWEEN_INVESTMENT_ACCOUNTS),
            user_id,
            position_id,
            target_investment_account_id,
            amount,
            comment,
            operated_at,
        )

    async def put__swap_crypto_investment_asset(
        self,
        user_id: int,
        position_id: int,
        from_amount: float,
        to_crypto_asset_id: int,
        to_amount: float,
        target_investment_account_id: Optional[int] = None,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
        value_in_base: Optional[float] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__SWAP_CRYPTO_INVESTMENT_ASSET),
            user_id,
            position_id,
            from_amount,
            to_crypto_asset_id,
            to_amount,
            target_investment_account_id,
            comment,
            operated_at,
            value_in_base,
        )

    async def put__create_crypto_protocol_position(
        self,
        user_id: int,
        investment_account_id: int,
        protocol_name: str,
        position_type: str,
        asset_symbol: str,
        quantity: Optional[float] = None,
        cost_basis_in_base: Optional[float] = None,
        current_quantity: Optional[float] = None,
        current_value_in_base: Optional[float] = None,
        rewards_claimed_in_base: Optional[float] = None,
        rewards_unclaimed_in_base: Optional[float] = None,
        crypto_asset_id: Optional[int] = None,
        network_code: Optional[str] = None,
        deposited_at: Optional[date] = None,
        comment: Optional[str] = None,
        metadata: Optional[dict] = None,
        source_position_id: Optional[int] = None,
        secondary_source_position_id: Optional[int] = None,
        secondary_quantity: Optional[float] = None,
        borrowed_crypto_asset_id: Optional[int] = None,
        borrowed_quantity: Optional[float] = None,
        borrowed_value_in_base: Optional[float] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_CRYPTO_PROTOCOL_POSITION),
            user_id,
            investment_account_id,
            protocol_name,
            position_type,
            asset_symbol,
            quantity,
            cost_basis_in_base,
            current_quantity,
            current_value_in_base,
            rewards_claimed_in_base,
            rewards_unclaimed_in_base,
            crypto_asset_id,
            network_code,
            deposited_at,
            comment,
            metadata or {},
            source_position_id,
            secondary_source_position_id,
            secondary_quantity,
            borrowed_crypto_asset_id,
            borrowed_quantity,
            borrowed_value_in_base,
        )

    async def put__lending_take_more_debt(
        self,
        user_id: int,
        position_id: int,
        debt_qty: float,
        value_in_base: Optional[float] = None,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
        borrowed_crypto_asset_id: Optional[int] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__LENDING_TAKE_MORE_DEBT),
            user_id,
            position_id,
            debt_qty,
            value_in_base,
            comment,
            operated_at,
            borrowed_crypto_asset_id,
        )

    async def put__lending_repay_debt(
        self,
        user_id: int,
        position_id: int,
        source_position_id: int,
        repay_qty: float,
        value_in_base: Optional[float] = None,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__LENDING_REPAY_DEBT),
            user_id,
            position_id,
            source_position_id,
            repay_qty,
            value_in_base,
            comment,
            operated_at,
        )

    async def put__crypto_pay_fee(
        self,
        user_id: int,
        source_position_id: int,
        quantity: float,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
        link_protocol_position_id: Optional[int] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CRYPTO_PAY_FEE),
            user_id,
            source_position_id,
            quantity,
            comment,
            operated_at,
            link_protocol_position_id,
        )

    async def set__update_crypto_protocol_position(
        self,
        user_id: int,
        position_id: int,
        quantity: Optional[float] = None,
        current_quantity: Optional[float] = None,
        current_value_in_base: Optional[float] = None,
        rewards_claimed_in_base: Optional[float] = None,
        rewards_unclaimed_in_base: Optional[float] = None,
        comment: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__UPDATE_CRYPTO_PROTOCOL_POSITION),
            user_id,
            position_id,
            quantity,
            current_quantity,
            current_value_in_base,
            rewards_claimed_in_base,
            rewards_unclaimed_in_base,
            comment,
            metadata,
        )

    async def set__close_crypto_protocol_position(
        self,
        user_id: int,
        position_id: int,
        withdrawn_at: Optional[date] = None,
        current_quantity: Optional[float] = None,
        current_value_in_base: Optional[float] = None,
        comment: Optional[str] = None,
        return_quantity: Optional[float] = None,
        return_value_in_base: Optional[float] = None,
        secondary_return_quantity: Optional[float] = None,
        secondary_return_value_in_base: Optional[float] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_SET__CLOSE_CRYPTO_PROTOCOL_POSITION),
            user_id,
            position_id,
            withdrawn_at,
            current_quantity,
            current_value_in_base,
            comment,
            return_quantity,
            return_value_in_base,
            secondary_return_quantity,
            secondary_return_value_in_base,
        )

    async def put__partial_close_crypto_protocol_position(
        self,
        user_id: int,
        position_id: int,
        principal_qty: float = 0,
        rewards_qty: float = 0,
        principal_value_in_base: Optional[float] = None,
        rewards_value_in_base: Optional[float] = None,
        returned_at: Optional[date] = None,
        comment: Optional[str] = None,
        secondary_principal_qty: Optional[float] = None,
        secondary_value_in_base: Optional[float] = None,
        secondary_rewards_qty: Optional[float] = None,
        secondary_rewards_value_in_base: Optional[float] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__PARTIAL_CLOSE_CRYPTO_PROTOCOL_POSITION),
            user_id,
            position_id,
            principal_qty,
            rewards_qty,
            principal_value_in_base,
            rewards_value_in_base,
            returned_at,
            comment,
            secondary_principal_qty,
            secondary_value_in_base,
            secondary_rewards_qty,
            secondary_rewards_value_in_base,
        )

    async def put__top_up_crypto_protocol_position(
        self,
        user_id: int,
        position_id: int,
        source_position_id: int,
        quantity: float,
        secondary_source_position_id: Optional[int] = None,
        secondary_quantity: Optional[float] = None,
        operated_at: Optional[date] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__TOP_UP_CRYPTO_PROTOCOL_POSITION),
            user_id,
            position_id,
            source_position_id,
            quantity,
            secondary_source_position_id,
            secondary_quantity,
            operated_at,
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

    F_GET__SCHEDULED_EXPENSES_FOR_CATEGORY = 'get__scheduled_expenses_for_category'
    F_GET__DUE_SCHEDULED_EXPENSES = 'get__due_scheduled_expenses'
    F_GET__CATEGORY_ACCOUNT_CURRENCIES = 'get__category_account_currencies'
    F_PUT__CREATE_SCHEDULED_EXPENSE = 'put__create_scheduled_expense'
    F_PUT__DELETE_SCHEDULED_EXPENSE = 'put__delete_scheduled_expense'
    F_PUT__ADVANCE_SCHEDULED_EXPENSE = 'put__advance_scheduled_expense'

    async def get__scheduled_expenses_for_category(self, user_id: int, category_id: int) -> list:
        result = await self.call_function(
            self._fn(self.F_GET__SCHEDULED_EXPENSES_FOR_CATEGORY),
            user_id,
            category_id,
        )
        return result if result else []

    async def get__category_account_currencies(self, user_id: int, category_id: int) -> list:
        result = await self.call_function(
            self._fn(self.F_GET__CATEGORY_ACCOUNT_CURRENCIES),
            user_id,
            category_id,
        )
        return result if result else []

    async def get__due_scheduled_expenses(self) -> list:
        result = await self.call_function(
            self._fn(self.F_GET__DUE_SCHEDULED_EXPENSES),
        )
        return result if result else []

    async def put__create_scheduled_expense(
        self,
        user_id: int,
        category_id: int,
        amount: float,
        currency_code: str,
        frequency: str,
        day_of_week: Optional[int] = None,
        day_of_month: Optional[int] = None,
        comment: Optional[str] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__CREATE_SCHEDULED_EXPENSE),
            user_id,
            category_id,
            amount,
            currency_code,
            frequency,
            day_of_week,
            day_of_month,
            comment,
        )

    async def put__delete_scheduled_expense(self, user_id: int, schedule_id: int) -> bool:
        return await self.call_function(
            self._fn(self.F_PUT__DELETE_SCHEDULED_EXPENSE),
            user_id,
            schedule_id,
        )

    async def put__advance_scheduled_expense(self, schedule_id: int, error: Optional[str] = None) -> str:
        return await self.call_function(
            self._fn(self.F_PUT__ADVANCE_SCHEDULED_EXPENSE),
            schedule_id,
            error,
        )

    F_GET__INCOME_SOURCE_PATTERN = 'get__income_source_pattern'
    F_PUT__UPSERT_INCOME_SOURCE_PATTERN = 'put__upsert_income_source_pattern'
    F_PUT__DELETE_INCOME_SOURCE_PATTERN = 'put__delete_income_source_pattern'
    F_PUT__RECORD_INCOME_SPLIT = 'put__record_income_split'

    async def get__income_source_pattern(self, user_id: int, income_source_id: int) -> Optional[dict]:
        result = await self.call_function(
            self._fn(self.F_GET__INCOME_SOURCE_PATTERN),
            user_id,
            income_source_id,
        )
        return result

    async def put__upsert_income_source_pattern(
        self,
        user_id: int,
        income_source_id: int,
        lines: list,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__UPSERT_INCOME_SOURCE_PATTERN),
            user_id,
            income_source_id,
            lines,
        )

    async def put__delete_income_source_pattern(self, user_id: int, income_source_id: int) -> bool:
        return await self.call_function(
            self._fn(self.F_PUT__DELETE_INCOME_SOURCE_PATTERN),
            user_id,
            income_source_id,
        )

    async def put__record_income_split(
        self,
        user_id: int,
        income_source_id: int,
        amount: float,
        currency_code: str,
        budget_amount_in_base: Optional[float] = None,
        comment: Optional[str] = None,
        operated_at: Optional[date] = None,
        tax_percent: Optional[float] = None,
    ) -> dict:
        return await self.call_function(
            self._fn(self.F_PUT__RECORD_INCOME_SPLIT),
            user_id,
            income_source_id,
            amount,
            currency_code,
            budget_amount_in_base,
            comment,
            operated_at,
            tax_percent,
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
