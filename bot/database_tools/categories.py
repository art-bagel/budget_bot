from typing import Any, List

from database_tools.databases import DataBase


class Categories(DataBase):

    def create_category(self, user_id: int, category_name: int, is_income: bool, is_group: bool = False) -> int:
        func = f'{self.schema}.create__category'
        return self.call_function(func, category_name, user_id, is_income, is_group)[0]

    def union_category_in_group(self, user_id: int, id_categories: list, percents: list, id_group: int) -> str:
        func = f'{self.schema}.union__category_in_group'
        return self.call_function(func, user_id, id_categories, percents, id_group)[0]

    def get_one_category_balance(self, user_id: int, category_id: int) -> float:
        func = f'{self.schema}.get_one__category_balance'
        return self.call_function(func, user_id, category_id)[0]

    def check_is_member_groups(self, group_id: int):
        func = f'{self.schema}.check__is_member_groups'
        return self.call_function(func, group_id)[0]

    def disband_group(self, user_id: int, group_id: int):
        func = f'{self.schema}.disband_group'
        return self.call_function(func, user_id, group_id)[0]

    def get_one_category(self, user_id: int, category_id: int):
        func = f'{self.schema}.get_one__category_data'
        return self.call_function(func, user_id, category_id)[0]

    def get_group_info(self, user_id: int, group_id: int):
        func = f'{self.schema}.get__group_info'
        return self.call_function(func, user_id, group_id)[0]

    def get_full_categories(self, user_id: int,  is_active: bool = None) -> List[dict[str, Any]]:
        """
        Возвращает список словарей с полной информацией по категориям пользователя
        :param user_id: пользователь телеграмм
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return:
        """
        func = f'{self.schema}.get__categories'
        result = self.call_function(func, user_id, is_active)[0]
        return result if result else []

    def get_full_categories_income(self, user_id: int, is_active: bool = None) -> List[dict[str, Any]]:
        """
        Возвращает список словарей с полной информацией по категориям дохода
        :param user_id: пользователь телеграмм
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return:
        """
        func = f'{self.schema}.get__categories_income'
        result = self.call_function(func, user_id, is_active)[0]
        return result if result else []

    def get_full_categories_not_income(self, user_id: int, is_active: bool = None) -> List[dict[str, Any]]:
        """
        Возвращает список словарей с полной информацией по категориям не являющимися доходом
        :param user_id: пользователь телеграмм
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return:
        """
        func = f'{self.schema}.get__categories_not_income'
        result = self.call_function(func, user_id, is_active)[0]
        return result if result else []

    def get_full_categories_group(self, user_id: int,  is_active: bool = None) -> List[dict[str, Any]]:
        """
        Возвращает список словарей с полной информацией по категориям являющимися группой
        :param user_id: пользователь телеграмм
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return:
        """
        func = f'{self.schema}.get__categories_group'
        result = self.call_function(func, user_id, is_active)[0]
        return result if result else []

    def get_name_categories(
            self,
            user_id: int,
            is_income: bool = None,
            is_active: bool = None,
            is_group: bool = None,
            exclude: list = None
    ) -> dict[str, int]:
        """
        Возвращает словарь в формате {"имя_категории": "id_категории", "is_owner": boolean}.
        Все ключи в нижнем регистре.
        :param user_id: пользователь телеграмм
        :param is_income: категория дохода или нет
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :param is_group: категория является группой или нет
        :param exclude: исключить id категорий из выдачи
        :return: dict
        """
        result = dict()
        categories = self.get_full_categories(user_id, is_active)

        for category in categories:
            if exclude and category["id_category"] in exclude:
                continue
            if is_income is None and is_group is None:
                result.update({category['name'].lower(): category['id_category']})
            elif is_income is None and category['is_group'] == is_group:
                result.update({category['name'].lower(): category['id_category']})
            elif category['is_income'] == is_income and is_group is None:
                result.update({category['name'].lower(): category['id_category']})
            elif category['is_income'] == is_income and category['is_group'] == is_group:
                result.update({category['name'].lower(): category['id_category']})
        return result

    def delete_category(self, category_id: int, user_id: int, category_receiver_id: int = None) -> str:
        """
        Удаляет категорию если она не состоит в группе.
        Если балан категории больше нуля необходим указать id категории куда будет переведен баланс.
        :param category_id: удаляемая категория
        :param user_id: пользователь телеграмм
        :param category_receiver_id: категория получатель остатка удаляемой категории
        :return: возвращает 'Ok' если запрос успешен.
        """
        func = f'{self.schema}.delete__category'
        return self.call_function(func, category_id, user_id, category_receiver_id)[0]

