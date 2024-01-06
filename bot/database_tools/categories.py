from typing import Any, List

from database_tools.databases import DataBase


class Categories(DataBase):

    def create_category(self, user_id: int, category_name: int, is_income: bool) -> str:
        func = f'{self.schema}.create__category'
        return self.call_function(func, category_name, user_id, is_income)[0]

    def get_one_category_balance(self, user_id: int, category_id: int) -> float:
        func = f'{self.schema}.get_one__category_balance'
        return self.call_function(func, user_id, category_id)[0]

    def get_full_categories(self, user_id: int, is_income: bool = None, is_active: bool = None) -> List[dict[str, Any]]:
        """
        Возвращает список словарей с полной информацией по категориям пользователя
        :param user_id: пользователь телеграмм
        :param is_income: принимает три состояния 1. None - все 2. True - только доход 3. False - только расход
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return:
        """
        func = f'{self.schema}.get__categories'
        return self.call_function(func, user_id, is_income, is_active)[0]

    def get_name_categories(self, user_id: int, is_income: bool = None, is_active: bool = None) -> dict[str, int]:
        """
        Возвращает словарь в формате {"имя_категории": "id_категории"}.
        Все ключи в нижнем регистре.
        :param user_id: пользователь телеграмм
        :param is_income: принимает три состояния 1. None - все 2. True - только доход 3. False - только расход
        :param is_active: принимает три состояния 1. None - все 2. True - только активные 3. False - только неактивные
        :return: dict
        """
        categories = self.get_full_categories(user_id, is_income, is_active)
        result = dict()
        for category in categories:
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

