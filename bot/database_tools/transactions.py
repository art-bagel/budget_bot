
from database_tools.databases import DataBase


class Transactions(DataBase):

    def create_transaction(self, user_id: int, id_from: int, amount: float, id_to: int, descr: str = '') -> str:
        func = f'{self.schema}.create__transaction'
        return self.call_function(func, user_id, id_from, amount, id_to, descr)[0]

    def change_balance_between_categories(self, user_id: int, id_from: int,  id_to: int, descr: str = '') -> str:
        func = f'{self.schema}.change__balance_between_categories'
        return self.call_function(func, user_id, id_from, id_to, descr)[0]

    def get_categories_balance(self, user_id: int) -> list:
        func = f'{self.schema}.get__categories_balance_json'
        result = self.call_function(func, user_id)[0]
        return result if result else []

    def get_last_transaction(self, user_id: int) -> list:
        func = f'{self.schema}.get__last_transaction'
        result = self.call_function(func, user_id)[0]
        return result if result else []

    def delete_last_transaction(self, user_id: int) -> str:
        func = f'{self.schema}.delete__last_transaction'
        return self.call_function(func, user_id)[0]
