from typing import Optional

from storage.databases import DataBase


class Auth(DataBase):
    """
    Способы входа и сессии. Не знает ни про пароли, ни про Telegram-подписи:
    хэширование и проверка подписи живут в backend, сюда приходит уже готовый
    секрет или хэш токена.
    """

    SCHEMA = 'budgeting'

    F_GET__AUTH_IDENTITY = 'get__auth_identity'
    F_PUT__AUTH_IDENTITY = 'put__auth_identity'
    F_SET__AUTH_LOGIN_RESULT = 'set__auth_login_result'
    F_PUT__SESSION = 'put__session'
    F_GET__SESSION_USER = 'get__session_user'
    F_GET__USER_AUTH_METHODS = 'get__user_auth_methods'
    F_GET__USER_SESSIONS = 'get__user_sessions'
    F_SET__REVOKE_SESSIONS = 'set__revoke_sessions'

    async def get__auth_identity(self, provider: str, provider_uid: str) -> Optional[dict]:
        """
        Возвращает способ входа вместе с секретом и состоянием блокировки.
        :param provider: Провайдер входа: 'telegram' | 'password'.
        :param provider_uid: Telegram id или email, в зависимости от провайдера.
        :return: Словарь со способом входа или None, если такого входа нет.
        """
        return await self.call_function(
            self._fn(self.F_GET__AUTH_IDENTITY),
            provider,
            provider_uid,
        )

    async def put__auth_identity(
        self,
        user_id: int,
        provider: str,
        provider_uid: str,
        secret: Optional[str] = None,
    ) -> dict:
        """
        Привязывает способ входа к существующему аккаунту или обновляет секрет.
        Привязка чужого способа входа падает ошибкой: аккаунты не сливаются.
        :param user_id: Идентификатор аккаунта.
        :param provider: Провайдер входа: 'telegram' | 'password'.
        :param provider_uid: Telegram id или email.
        :param secret: Хэш пароля для 'password', None для 'telegram'.
        :return: Словарь со статусом привязки.
        """
        return await self.call_function(
            self._fn(self.F_PUT__AUTH_IDENTITY),
            user_id,
            provider,
            provider_uid,
            secret,
        )

    async def get__user_auth_methods(self, user_id: int) -> list:
        """
        Возвращает привязанные к аккаунту способы входа без секретов.
        :param user_id: Идентификатор аккаунта.
        :return: Список способов входа.
        """
        return await self.call_function(
            self._fn(self.F_GET__USER_AUTH_METHODS),
            user_id,
        )

    async def set__auth_login_result(
        self,
        provider: str,
        provider_uid: str,
        success: bool,
        max_attempts: int = 5,
        lock_seconds: int = 900,
    ) -> Optional[dict]:
        """
        Фиксирует итог попытки входа: успех обнуляет счетчик, серия неудач
        блокирует способ входа на время.
        :param provider: Провайдер входа.
        :param provider_uid: Telegram id или email.
        :param success: Были ли учетные данные верными.
        :param max_attempts: Число неудач до блокировки.
        :param lock_seconds: Длительность блокировки в секундах.
        :return: Словарь со счетчиком и состоянием блокировки, либо None.
        """
        return await self.call_function(
            self._fn(self.F_SET__AUTH_LOGIN_RESULT),
            provider,
            provider_uid,
            success,
            max_attempts,
            lock_seconds,
        )

    async def put__session(
        self,
        user_id: int,
        token_hash: bytes,
        device: Optional[str] = None,
        ttl_seconds: int = 7776000,
    ) -> dict:
        """
        Открывает сессию. В базу уходит только sha256 от токена.
        :param user_id: Идентификатор аккаунта.
        :param token_hash: sha256 от токена сессии.
        :param device: Человекочитаемая метка устройства.
        :param ttl_seconds: Срок жизни сессии в секундах.
        :return: Словарь со сроком действия сессии.
        """
        return await self.call_function(
            self._fn(self.F_PUT__SESSION),
            user_id,
            token_hash,
            device,
            ttl_seconds,
        )

    async def get__session_user(
        self,
        token_hash: bytes,
        ttl_seconds: int = 7776000,
    ) -> Optional[int]:
        """
        Разрешает хэш токена в идентификатор пользователя, продлевая сессию.
        Неизвестный и истекший токен неотличимы — оба дают None.
        :param token_hash: sha256 от токена сессии.
        :param ttl_seconds: Срок, на который продлевается сессия.
        :return: Идентификатор пользователя или None.
        """
        return await self.call_function(
            self._fn(self.F_GET__SESSION_USER),
            token_hash,
            ttl_seconds,
        )

    async def get__user_sessions(self, user_id: int) -> list:
        """
        Возвращает активные сессии для экрана устройств.
        :param user_id: Идентификатор аккаунта.
        :return: Список сессий, свежие первыми.
        """
        return await self.call_function(
            self._fn(self.F_GET__USER_SESSIONS),
            user_id,
        )

    async def set__revoke_sessions(
        self,
        user_id: int,
        token_hash: Optional[bytes] = None,
        except_token_hash: Optional[bytes] = None,
    ) -> dict:
        """
        Отзывает сессии аккаунта: конкретную, все кроме текущей, либо все.
        :param user_id: Идентификатор аккаунта.
        :param token_hash: Отозвать именно эту сессию.
        :param except_token_hash: Отозвать все, кроме этой сессии.
        :return: Словарь с числом отозванных сессий.
        """
        return await self.call_function(
            self._fn(self.F_SET__REVOKE_SESSIONS),
            user_id,
            token_hash,
            except_token_hash,
        )
