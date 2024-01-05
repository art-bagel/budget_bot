import psycopg2 as ps


class ConnectData:
    def __init__(self, host, port, database, schema, username, password):
        self.host = host
        self.port = port
        self.database = database
        self.schema = schema
        self.username = username
        self.password = password


class DataBase:
    def __init__(self, params: ConnectData):
        self.host = params.host
        self.port = params.port
        self.database = params.database
        self.schema = params.schema
        self.username = params.username
        self.password = params.password

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
