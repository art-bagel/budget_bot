"""
Хэширование паролей на scrypt из стандартной библиотеки.

Отдельной зависимости (argon2, bcrypt, passlib) здесь нет намеренно: scrypt
входит в hashlib, а его параметры ниже — одна из конфигураций, рекомендуемых
OWASP. Формат хэша самоописывающийся, поэтому параметры можно поднять позже,
не ломая уже сохраненные пароли.
"""

import base64
import hashlib
import hmac
import secrets

# OWASP-конфигурация scrypt: N=2^15, r=8, p=3 (~32 МиБ памяти на проверку).
_N = 2 ** 15
_R = 8
_P = 3
_SALT_BYTES = 16
_KEY_BYTES = 32

MIN_PASSWORD_LENGTH = 10


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    # hashlib.scrypt без maxmem упирается в лимит OpenSSL в 32 МиБ и падает.
    return hashlib.scrypt(
        password.encode('utf-8'),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=_KEY_BYTES,
        maxmem=128 * n * r * 2,
    )


def hash_password(password: str) -> str:
    """
    Считает хэш пароля вместе с солью и параметрами.
    :param password: Пароль в открытом виде.
    :return: Строка вида `scrypt$N$r$p$salt$hash` для хранения в базе.
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = _derive(password, salt, _N, _R, _P)
    return 'scrypt${n}${r}${p}${salt}${hash}'.format(
        n=_N,
        r=_R,
        p=_P,
        salt=base64.b64encode(salt).decode('ascii'),
        hash=base64.b64encode(derived).decode('ascii'),
    )


def verify_password(password: str, stored: str | None) -> bool:
    """
    Сверяет пароль с сохраненным хэшем за постоянное время.
    :param password: Пароль в открытом виде.
    :param stored: Сохраненный хэш или None, если способа входа нет.
    :return: True, если пароль подходит.
    """
    if not stored:
        # Аккаунта нет, но время ответа должно быть как у существующего:
        # иначе по задержке перебираются зарегистрированные email.
        _derive(password, b'timing-equalizer', _N, _R, _P)
        return False

    try:
        algorithm, n_raw, r_raw, p_raw, salt_raw, hash_raw = stored.split('$')
        if algorithm != 'scrypt':
            return False
        salt = base64.b64decode(salt_raw)
        expected = base64.b64decode(hash_raw)
        derived = _derive(password, salt, int(n_raw), int(r_raw), int(p_raw))
    except (ValueError, TypeError):
        return False

    return hmac.compare_digest(derived, expected)


def _self_check() -> None:
    password = 'correct horse battery staple'
    stored = hash_password(password)

    assert stored.startswith('scrypt$'), stored
    assert password not in stored, 'пароль не должен попадать в хэш в открытом виде'
    assert verify_password(password, stored)
    assert not verify_password(password + 'x', stored)
    assert not verify_password('', stored)

    # Соль случайна: одинаковые пароли дают разные хэши.
    assert hash_password(password) != stored

    # Несуществующий способ входа и битый хэш не пускают и не падают.
    assert not verify_password(password, None)
    assert not verify_password(password, '')
    assert not verify_password(password, 'мусор')
    assert not verify_password(password, 'scrypt$1$2$3$@@@$@@@')
    assert not verify_password(password, 'argon2$16384$8$1$c2FsdA==$aGFzaA==')

    # Старый хэш со слабыми параметрами все еще проверяется: формат
    # самоописывающийся, поэтому ужесточение параметров не ломает вход.
    legacy_salt = secrets.token_bytes(_SALT_BYTES)
    legacy = 'scrypt$16384$8$1${salt}${hash}'.format(
        salt=base64.b64encode(legacy_salt).decode('ascii'),
        hash=base64.b64encode(_derive(password, legacy_salt, 16384, 8, 1)).decode('ascii'),
    )
    assert verify_password(password, legacy)

    print('passwords: все проверки пройдены')


if __name__ == '__main__':
    _self_check()
