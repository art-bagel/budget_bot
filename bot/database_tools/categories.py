from database_tools.databases import DataBase


class Categories(DataBase):

    def create_category(self, user_id, category_name, is_income):
        func = f'{self.schema}.create__category'
        return self.call_function(func, category_name, user_id, is_income)[0]

    def get_one_category_balance(self, user_id, category_id):
        func = f'{self.schema}.get_one__category_balance'
        return self.call_function(func, user_id, category_id)[0]
