import asyncio
import json

import asyncpg


class ConnectData:
    def __init__(self, host, port, database, schema, username, password):
        """
        Хранит параметры подключения к базе данных.
        :param host: Хост базы данных.
        :param port: Порт базы данных.
        :param database: Имя базы данных.
        :param schema: Схема приложения по умолчанию.
        :param username: Имя пользователя базы данных.
        :param password: Пароль пользователя базы данных.
        """
        self.host = host
        self.port = port
        self.database = database
        self.schema = schema
        self.username = username
        self.password = password


class DataBase:
    SCHEMA = None

    def __init__(self, params: ConnectData):
        """
        Инициализирует базовый storage-объект.
        :param params: Контейнер с параметрами подключения к базе данных.
        """
        self.host = params.host
        self.port = params.port
        self.database = params.database
        self._schema = params.schema
        self.username = params.username
        self.password = params.password
        self._pool = None
        self._pool_lock = None

    @property
    def schema(self):
        """
        Возвращает эффективное имя схемы.
        :return: Имя схемы, используемое для SQL-функций.
        """
        return self.SCHEMA or self._schema

    async def _init_connection(self, connection: asyncpg.Connection) -> None:
        """
        Настраивает codecs для asyncpg-соединения.
        :param connection: Открытое asyncpg-соединение.
        """
        await connection.set_type_codec(
            'json',
            schema='pg_catalog',
            encoder=json.dumps,
            decoder=json.loads,
        )
        await connection.set_type_codec(
            'jsonb',
            schema='pg_catalog',
            encoder=json.dumps,
            decoder=json.loads,
            format='text',
        )

    async def _get_pool(self):
        """
        Возвращает или создает пул asyncpg-соединений.
        :return: Пул asyncpg-соединений.
        """
        if self._pool is not None:
            return self._pool

        if self._pool_lock is None:
            self._pool_lock = asyncio.Lock()

        async with self._pool_lock:
            if self._pool is None:
                self._pool = await asyncpg.create_pool(
                    host=self.host,
                    port=int(self.port),
                    database=self.database,
                    user=self.username,
                    password=self.password,
                    min_size=1,
                    max_size=5,
                    init=self._init_connection,
                )

        return self._pool

    def _fn(self, func_name: str) -> str:
        """
        Собирает полное имя PostgreSQL-функции.
        :param func_name: Имя функции в формате `schema__function_name` или сырое имя функции.
        :return: Полное имя PostgreSQL-функции в формате `schema.function_name`.
        """
        return '{schema}.{name}'.format(schema=self.schema, name=func_name)

    def _build_function_query(self, func: str, args_count: int) -> str:
        """
        Собирает SQL-запрос для вызова PostgreSQL-функции.
        :param func: Полное имя PostgreSQL-функции.
        :param args_count: Количество аргументов функции.
        :return: SQL-запрос вида `SELECT schema.function($1, ...)`.
        """
        if args_count == 0:
            return 'SELECT {func}()'.format(func=func)

        placeholders = ', '.join('${idx}'.format(idx=index) for index in range(1, args_count + 1))
        return 'SELECT {func}({placeholders})'.format(func=func, placeholders=placeholders)

    async def call_function(self, func: str, *args):
        """
        Асинхронно вызывает PostgreSQL-функцию.
        :param func: Полное имя PostgreSQL-функции.
        :param args: Позиционные аргументы функции.
        :return: Первое поле первой возвращенной строки.
        """
        pool = await self._get_pool()
        query = self._build_function_query(func, len(args))

        async with pool.acquire() as connection:
            return await connection.fetchval(query, *args)

    async def close(self) -> None:
        """
        Закрывает пул asyncpg-соединений.
        """
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
