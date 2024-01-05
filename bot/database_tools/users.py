from database_tools.databases import DataBase


class Users(DataBase):

    def create_user_if_not_exists(self, user):
        func = f'{self.schema}.create__user'
        return self.call_function(
                        func,
                        user.id,
                        user.username,
                        user.first_name,
                        user.last_name)[0]
