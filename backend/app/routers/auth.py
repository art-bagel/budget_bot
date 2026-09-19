import hashlib
import hmac
import re
import time
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.app.config import settings
from backend.app.dependencies import (
    PROVIDER_PASSWORD,
    PROVIDER_TELEGRAM,
    AuthPrincipal,
    CurrentUser,
    get_auth_principal,
    get_current_user,
    new_session_token,
    parse_telegram_init_data,
    session_token_hash,
)
from backend.app.services.passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
from backend.app.storage import auth, context


router = APIRouter(prefix='/api/v1/auth', tags=['auth'])

DELETE_CONFIRM_TTL_SECONDS = 600

# Намеренно грубая проверка: единственная задача — не пустить в базу заведомый
# мусор. Настоящая валидация email — это подтверждение письмом, а не регулярка.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+\.[^@\s]+$')

# Один и тот же ответ на неверный пароль и несуществующий аккаунт:
# иначе по ошибке можно перебрать, какие email зарегистрированы.
_INVALID_CREDENTIALS = 'Неверный email или пароль'


def _delete_confirm_secret() -> bytes:
    secret = settings.telegram_bot_token or settings.credentials_encryption_key or 'dev-only-secret'
    return secret.encode()


def _sign_delete_request(user_id: int, timestamp: int) -> str:
    payload = f'delete-account:{user_id}:{timestamp}'.encode()
    return hmac.new(_delete_confirm_secret(), payload, hashlib.sha256).hexdigest()


def _build_delete_confirm_token(user_id: int) -> str:
    timestamp = int(time.time())
    return f'{timestamp}.{_sign_delete_request(user_id, timestamp)}'


def _verify_delete_confirm_token(user_id: int, token: str) -> bool:
    timestamp_part, _, signature = token.partition('.')

    try:
        timestamp = int(timestamp_part)
    except ValueError:
        return False

    if not signature or time.time() - timestamp > DELETE_CONFIRM_TTL_SECONDS:
        return False

    return hmac.compare_digest(_sign_delete_request(user_id, timestamp), signature)


def _normalize_email(value: str) -> str:
    value = value.strip().lower()

    if not _EMAIL_RE.match(value):
        raise ValueError('Некорректный email')

    return value


def _validate_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f'Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов')

    return value


async def _open_session(user_id: int, device: Optional[str]) -> 'SessionResponse':
    token = new_session_token()
    result = await auth.put__session(
        user_id=user_id,
        token_hash=session_token_hash(token),
        device=(device or '').strip()[:100] or None,
        ttl_seconds=settings.session_ttl_seconds,
    )
    return SessionResponse(
        token=token,
        user_id=user_id,
        expires_at=str(result['expires_at']),
    )


class RegisterRequest(BaseModel):
    base_currency_code: str


class RegisterResponse(BaseModel):
    status: str
    user_id: int
    bank_account_id: int
    unallocated_category_id: int
    fx_result_category_id: int
    base_currency_code: str
    hints_enabled: bool
    theme: str = Field(default='system')


class SessionResponse(BaseModel):
    token: str
    user_id: int
    expires_at: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    base_currency_code: str
    invite_code: Optional[str] = None
    device: Optional[str] = None

    _check_email = field_validator('email')(lambda cls, v: _normalize_email(v))
    _check_password = field_validator('password')(lambda cls, v: _validate_password(v))


class LoginRequest(BaseModel):
    email: str
    password: str
    device: Optional[str] = None

    @field_validator('email')
    @classmethod
    def email_must_be_normalized(cls, v: str) -> str:
        # На входе не валидируем строго: неизвестный email и неверный пароль
        # должны быть неотличимы, а ошибка формата их бы различала.
        return v.strip().lower()


class SetPasswordRequest(BaseModel):
    email: str
    new_password: str
    current_password: Optional[str] = None

    _check_email = field_validator('email')(lambda cls, v: _normalize_email(v))
    _check_password = field_validator('new_password')(lambda cls, v: _validate_password(v))


class AuthMethod(BaseModel):
    provider: Literal['telegram', 'password']
    provider_uid: str
    has_secret: bool
    created_at: str


class SessionInfo(BaseModel):
    session_id: str
    device: Optional[str] = None
    created_at: str
    last_seen_at: str
    expires_at: str
    is_current: bool = False


class RevokedResponse(BaseModel):
    revoked: int


class LinkResponse(BaseModel):
    status: str
    provider: str
    provider_uid: str


class DeleteAccountRequestResponse(BaseModel):
    confirm_token: str
    expires_in_seconds: int


class DeleteAccountResponse(BaseModel):
    status: str
    user_id: int


@router.post('/register', response_model=RegisterResponse)
async def register(
    body: RegisterRequest,
    principal: AuthPrincipal = Depends(get_auth_principal),
) -> RegisterResponse:
    """
    Регистрация из Telegram WebApp: аккаунт заводится под telegram id и сразу
    получает telegram как способ входа.
    """
    if principal.telegram_id is None:
        raise HTTPException(status_code=400, detail='Регистрация доступна только из Telegram')

    result = await context.put__register_user_context(
        user_id=principal.telegram_id,
        base_currency_code=body.base_currency_code,
        username=principal.username,
        first_name=principal.first_name,
        last_name=principal.last_name,
    )
    await auth.put__auth_identity(
        user_id=int(result['user_id']),
        provider=PROVIDER_TELEGRAM,
        provider_uid=str(principal.telegram_id),
    )
    return RegisterResponse(**result)


@router.post('/signup', response_model=SessionResponse)
async def sign_up(body: SignUpRequest) -> SessionResponse:
    """
    Регистрация по email вне Telegram. Закрыта кодом-приглашением: открытая
    регистрация в финансовом API означала бы, что аккаунт себе заводит любой,
    кто узнал адрес сервера.
    """
    if not settings.signup_invite_code:
        raise HTTPException(status_code=403, detail='Регистрация по email отключена')

    # Сравнение байтами, а не строками: compare_digest на str падает
    # на не-ASCII, а код приглашения приходит от пользователя.
    if not body.invite_code or not hmac.compare_digest(
        body.invite_code.encode('utf-8'),
        settings.signup_invite_code.encode('utf-8'),
    ):
        raise HTTPException(status_code=403, detail='Неверный код приглашения')

    if await auth.get__auth_identity(PROVIDER_PASSWORD, body.email):
        raise HTTPException(status_code=409, detail='Этот email уже занят')

    result = await context.put__register_user_context(
        user_id=None,
        base_currency_code=body.base_currency_code,
        username=None,
        first_name=None,
        last_name=None,
    )
    user_id = int(result['user_id'])

    await auth.put__auth_identity(
        user_id=user_id,
        provider=PROVIDER_PASSWORD,
        provider_uid=body.email,
        secret=hash_password(body.password),
    )

    return await _open_session(user_id, body.device)


@router.post('/login', response_model=SessionResponse)
async def login(body: LoginRequest) -> SessionResponse:
    identity = await auth.get__auth_identity(PROVIDER_PASSWORD, body.email)

    if identity and identity.get('is_locked'):
        raise HTTPException(
            status_code=429,
            detail='Слишком много неудачных попыток, вход временно заблокирован',
        )

    # verify_password вызывается и для несуществующего аккаунта: одинаковое
    # время ответа не дает перебрать зарегистрированные email.
    is_valid = verify_password(body.password, identity.get('secret') if identity else None)

    if identity:
        await auth.set__auth_login_result(PROVIDER_PASSWORD, body.email, is_valid)

    if not identity or not is_valid:
        raise HTTPException(status_code=401, detail=_INVALID_CREDENTIALS)

    return await _open_session(int(identity['user_id']), body.device)


@router.post('/logout', response_model=RevokedResponse)
async def logout(user: CurrentUser = Depends(get_current_user)) -> RevokedResponse:
    if user.session_token_hash is None:
        raise HTTPException(status_code=400, detail='Текущий вход не является сессией')

    result = await auth.set__revoke_sessions(user.user_id, token_hash=user.session_token_hash)
    return RevokedResponse(**result)


@router.get('/methods', response_model=list[AuthMethod])
async def list_auth_methods(user: CurrentUser = Depends(get_current_user)) -> list[AuthMethod]:
    methods = await auth.get__user_auth_methods(user.user_id)
    return [AuthMethod(**{**method, 'created_at': str(method['created_at'])}) for method in methods]


@router.get('/sessions', response_model=list[SessionInfo])
async def list_sessions(user: CurrentUser = Depends(get_current_user)) -> list[SessionInfo]:
    current_id = user.session_token_hash.hex() if user.session_token_hash else None
    sessions = await auth.get__user_sessions(user.user_id)
    return [
        SessionInfo(
            **{
                **session,
                'created_at': str(session['created_at']),
                'last_seen_at': str(session['last_seen_at']),
                'expires_at': str(session['expires_at']),
            },
            is_current=session['session_id'] == current_id,
        )
        for session in sessions
    ]


@router.delete('/sessions/{session_id}', response_model=RevokedResponse)
async def revoke_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> RevokedResponse:
    try:
        token_hash = bytes.fromhex(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail='Некорректный идентификатор сессии') from None

    result = await auth.set__revoke_sessions(user.user_id, token_hash=token_hash)
    return RevokedResponse(**result)


@router.post('/password', response_model=LinkResponse)
async def set_password(
    body: SetPasswordRequest,
    user: CurrentUser = Depends(get_current_user),
) -> LinkResponse:
    """
    Добавляет или меняет вход по email и паролю у текущего аккаунта.

    Если пароль уже был — требуется текущий: иначе перехваченная сессия
    позволяла бы сменить пароль и закрепиться в аккаунте навсегда.
    """
    methods = await auth.get__user_auth_methods(user.user_id)
    existing = next(
        (method for method in methods if method['provider'] == PROVIDER_PASSWORD and method['has_secret']),
        None,
    )

    if existing:
        identity = await auth.get__auth_identity(PROVIDER_PASSWORD, existing['provider_uid'])

        if not body.current_password or not verify_password(
            body.current_password,
            identity.get('secret') if identity else None,
        ):
            raise HTTPException(status_code=403, detail='Неверный текущий пароль')

    result = await auth.put__auth_identity(
        user_id=user.user_id,
        provider=PROVIDER_PASSWORD,
        provider_uid=body.email,
        secret=hash_password(body.new_password),
    )

    # Смена пароля должна выбивать все прочие устройства.
    await auth.set__revoke_sessions(user.user_id, except_token_hash=user.session_token_hash)

    return LinkResponse(**result)


@router.post('/telegram/link', response_model=LinkResponse)
async def link_telegram(
    user: CurrentUser = Depends(get_current_user),
    x_telegram_init_data: Optional[str] = Header(None),
) -> LinkResponse:
    """
    Привязывает Telegram к текущему аккаунту.

    Доказательств нужно два, и оба приходят в одном запросе: сессионный токен
    подтверждает владение аккаунтом, подписанный initData — владение Telegram.
    Обменивать коды между двумя клиентами не требуется.
    """
    if not x_telegram_init_data:
        raise HTTPException(status_code=400, detail='Привязка доступна только из Telegram')

    telegram_user = parse_telegram_init_data(x_telegram_init_data)
    result = await auth.put__auth_identity(
        user_id=user.user_id,
        provider=PROVIDER_TELEGRAM,
        provider_uid=str(telegram_user['id']),
    )
    return LinkResponse(**result)


@router.post('/account/delete-request', response_model=DeleteAccountRequestResponse)
async def request_account_deletion(
    user: CurrentUser = Depends(get_current_user),
) -> DeleteAccountRequestResponse:
    """
    Первый шаг удаления аккаунта: выдает короткоживущий подписанный токен.
    Само удаление возможно только по этому токену — случайный или единичный
    DELETE-запрос аккаунт не удалит.
    """
    return DeleteAccountRequestResponse(
        confirm_token=_build_delete_confirm_token(user.user_id),
        expires_in_seconds=DELETE_CONFIRM_TTL_SECONDS,
    )


@router.delete('/account', response_model=DeleteAccountResponse)
async def delete_account(
    confirm_token: str = Query(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> DeleteAccountResponse:
    if not _verify_delete_confirm_token(user.user_id, confirm_token):
        raise HTTPException(
            status_code=400,
            detail='Недействительный или истекший токен подтверждения удаления',
        )

    result = await context.set__delete_user_account(user.user_id)
    return DeleteAccountResponse(**result)
