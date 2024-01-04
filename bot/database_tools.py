import psycopg2 as ps


class DataBase:
    def __init__(self, host, port, database, username, password):
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password

    def _get_db_connection(self):
        return ps.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.username,
            password=self.password
        )

    def call_function(self, func: str, *args):
        with self._get_db_connection() as con:
            cur = con.cursor()
            cur.callproc(func, args)
            response = cur.fetchall()[0]
            cur.close()

        return response


class UserTools(DataBase):

    def create_user_if_not_exists(self, schema, user):
        func = f'{schema}.create__user'
        return self.call_function(
                        func,
                        user.id,
                        user.username,
                        user.first_name,
                        user.last_name)[0]

