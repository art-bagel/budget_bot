
from database_tools.databases import DataBase


class Transactions(DataBase):

    def change_balance_between_categories(self, user_id: int, id_from: int,  id_to: int, descr: str = '') -> str:
        func = f'{self.schema}.change__balance_between_categories'
        return self.call_function(func, user_id, id_from, id_to, descr)[0]


