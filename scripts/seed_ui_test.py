"""
Synthetic seed for browser (Playwright) tests.

Creates one fictional user through the public API, so business rules and
password hashing stay in the backend. All values here are made up.

Usage (env of the test API, see scripts/check.sh):
    DB_DATABASE=budget_test_ui DB_HOST=127.0.0.1 ... python scripts/seed_ui_test.py

Refuses to run against anything but a local budget_test_* database: the seed
must never write into the dev copy of prod or into prod itself.
"""

import os
import sys
from pathlib import Path

EMAIL = 'ui-test@example.com'
PASSWORD = 'ui-test-password-0000'
# Second fictional user: every portfolio asset type, kept apart so the first
# user's overview numbers and screenshots stay as they are.
PORTFOLIO_EMAIL = 'ui-portfolio@example.com'
PORTFOLIO_PASSWORD = 'ui-portfolio-password-0000'
LOCAL_HOSTS = {'127.0.0.1', 'localhost'}


def assert_test_database(env) -> None:
    """
    Stops the seed unless it targets a local throwaway database.
    :param env: Mapping with DB_HOST and DB_DATABASE.
    """
    database = env.get('DB_DATABASE') or ''
    host = env.get('DB_HOST') or ''
    if not database.startswith('budget_test_') or host not in LOCAL_HOSTS:
        raise SystemExit(
            f'seed_ui_test: refusing to seed {database!r} on {host!r}; '
            'only budget_test_* on 127.0.0.1/localhost'
        )


def caller(client):
    """
    Returns a request helper that stops the seed on any HTTP error.
    :param client: TestClient of the application.
    """
    def call(method: str, url: str, **kwargs):
        response = client.request(method, url, **kwargs)
        if response.status_code >= 400:
            raise SystemExit(f'seed_ui_test: {method} {url} -> {response.status_code} {response.text}')
        return response.json()
    return call


def sign_up(client, email: str, password: str) -> dict:
    """
    Creates a user, makes the client act as them and returns their context.
    :param client: TestClient of the application.
    :param email: Fictional email.
    :param password: Fictional password.
    """
    call = caller(client)
    session = call('POST', '/api/v1/auth/signup', json={
        'email': email, 'password': password, 'base_currency_code': 'RUB',
        'invite_code': os.environ['SIGNUP_INVITE_CODE'],
    })
    client.headers['Authorization'] = f"Bearer {session['token']}"
    return call('GET', '/api/v1/auth/context')


def seed(client) -> None:
    """
    Fills the account with fictional RUB money, budget categories, an overpaid credit card and a crypto position.
    :param client: TestClient of the application.
    """
    call = caller(client)
    context = sign_up(client, EMAIL, PASSWORD)
    account = context['bank_account_id']
    unallocated = context['unallocated_category_id']

    call('POST', '/api/v1/operations/income', json={
        'bank_account_id': account, 'amount': 150000, 'currency_code': 'RUB',
        'comment': 'Зарплата', 'operated_at': '2026-01-05',
    })
    for name in ('Зарплата', 'Фриланс'):
        call('POST', '/api/v1/income-sources', json={'name': name})
    for name, budget, spent in (('Продукты', 30000, 8450), ('Транспорт', 6000, 1200), ('Кафе', 8000, 2350)):
        category = call('POST', '/api/v1/categories', json={'name': name, 'kind': 'regular'})['id']
        call('POST', '/api/v1/operations/allocate', json={
            'from_category_id': unallocated, 'to_category_id': category, 'amount_in_base': str(budget),
        })
        call('POST', '/api/v1/operations/expense', json={
            'bank_account_id': account, 'category_id': category, 'amount': str(spent),
            'currency_code': 'RUB', 'operated_at': '2026-01-10',
        })

    card = call('POST', '/api/v1/bank-accounts/credit', json={
        'name': 'Тестовая кредитка', 'credit_kind': 'credit_card', 'currency_code': 'RUB',
        'credit_limit': 50000, 'interest_rate': 24.9, 'payment_day': 15,
    })['id']
    # Overpaid card: own money on it shows as an overpayment, not as debt.
    call('POST', '/api/v1/operations/account-transfer', json={
        'from_account_id': account, 'to_account_id': card, 'currency_code': 'RUB', 'amount': '1500',
    })

    # Fictional coin without a price source: no exchange lookups, stable screenshots.
    wallet = call('POST', '/api/v1/bank-accounts', json={
        'name': 'Тестовый криптокошелёк', 'account_kind': 'investment', 'investment_asset_type': 'crypto',
    })['id']
    asset = call('POST', '/api/v1/crypto/assets', json={
        'symbol': 'TSTC', 'name': 'Test Coin', 'network_code': 'manual', 'decimals': 8,
    })['id']
    call('POST', '/api/v1/crypto/source-events', json={
        'anchor_account_id': wallet, 'source_namespace': 'ui-test-seed', 'source_id': 'buy-1',
        'occurred_at': '2026-01-12T12:00:00Z', 'order_in_timestamp': 0, 'accounting_date': '2026-01-12',
        'commands': [{'kind': 'buy_fiat', 'payload': {
            'investment_account_id': wallet, 'bank_account_id': account, 'crypto_asset_id': asset,
            'quantity': '12.5', 'fiat_currency_code': 'RUB', 'fiat_amount': '25000',
        }}],
    })

    # GRAM in the coin reference only (manual network: no price lookups, local icon):
    # the sale form of a free gift starts with it.
    call('POST', '/api/v1/crypto/assets', json={
        'symbol': 'GRAM', 'name': 'Gram', 'network_code': 'manual', 'decimals': 9,
    })

    # A collection with one free gift: browser tests sell it by mistake and undo it.
    gifts = call('POST', '/api/v1/bank-accounts', json={
        'name': 'Тестовые подарки', 'account_kind': 'investment', 'investment_asset_type': 'collectible',
    })['id']
    call('POST', '/api/v1/portfolio/positions', json={
        'request_id': '00000000-0000-4000-8000-0000000000a1', 'received_free': True,
        'investment_account_id': gifts, 'asset_type_code': 'collectible', 'title': 'Тестовый подарок',
        'quantity': 1, 'amount_in_currency': 0, 'currency_code': 'RUB', 'opened_at': '2026-01-12',
        'metadata': {'item_kind': 'telegram_gift'},
    })


def seed_portfolio(client) -> None:
    """
    Second user with one account of every portfolio asset type the browser tests cover.
    No MOEX tickers and only manual coins: the screen makes no outside requests.
    :param client: TestClient of the application.
    """
    call = caller(client)
    context = sign_up(client, PORTFOLIO_EMAIL, PORTFOLIO_PASSWORD)
    account = context['bank_account_id']
    call('POST', '/api/v1/operations/income', json={
        'bank_account_id': account, 'amount': 500000, 'currency_code': 'RUB',
        'comment': 'Зарплата', 'operated_at': '2026-01-05',
    })

    def investment(name: str, asset_type: str, funding: int = 0) -> int:
        account_id = call('POST', '/api/v1/bank-accounts', json={
            'name': name, 'account_kind': 'investment', 'investment_asset_type': asset_type,
        })['id']
        if funding:
            call('POST', '/api/v1/operations/account-transfer', json={
                'from_account_id': account, 'to_account_id': account_id, 'currency_code': 'RUB', 'amount': str(funding),
            })
        return account_id

    def position(account_id: int, asset_type: str, title: str, amount: int, metadata: dict, **extra) -> int:
        return call('POST', '/api/v1/portfolio/positions', json={
            'investment_account_id': account_id, 'asset_type_code': asset_type, 'title': title,
            'amount_in_currency': amount, 'currency_code': 'RUB', 'opened_at': '2026-01-12',
            'metadata': metadata, **extra,
        })['id']

    broker = investment('Тестовый брокер', 'security', 100000)
    position(broker, 'security', 'Тестовая облигация', 40000, {'security_kind': 'bond'}, quantity=40)
    fund = position(broker, 'security', 'Тестовый фонд', 20000, {'security_kind': 'fund'}, quantity=100)
    call('POST', f'/api/v1/portfolio/positions/{fund}/income', json={
        'amount': 1500, 'currency_code': 'RUB', 'income_kind': 'dividend', 'received_at': '2026-01-15',
    })

    deposit = investment('Тестовый вклад', 'deposit', 60000)
    position(deposit, 'deposit', 'Тестовый накопительный', 50000, {
        'deposit_kind': 'savings_account', 'interest_rate': 12, 'last_accrual_date': '2026-01-12',
        'capitalization_period': 'daily',
    })

    other = investment('Тестовый краудлендинг', 'other', 30000)
    position(other, 'other', 'Тестовый займ', 20000, {})

    wallet = investment('Тестовый кошелёк', 'crypto')
    investment('Второй кошелёк', 'crypto')
    coin = call('POST', '/api/v1/crypto/assets', json={
        'symbol': 'TSTP', 'name': 'Test Portfolio Coin', 'network_code': 'manual', 'decimals': 8,
    })['id']
    call('POST', '/api/v1/crypto/source-events', json={
        'anchor_account_id': wallet, 'source_namespace': 'ui-test-seed', 'source_id': 'portfolio-buy-1',
        'occurred_at': '2026-01-12T12:00:00Z', 'order_in_timestamp': 0, 'accounting_date': '2026-01-12',
        'commands': [{'kind': 'buy_fiat', 'payload': {
            'investment_account_id': wallet, 'bank_account_id': account, 'crypto_asset_id': coin,
            'quantity': '10', 'fiat_currency_code': 'RUB', 'fiat_amount': '20000',
        }}],
    })

    collection = investment('Тестовая коллекция', 'collectible', 10000)
    position(collection, 'collectible', 'Тестовая открытка', 3000, {'item_kind': 'other', 'item_attributes': {}},
             request_id='00000000-0000-4000-8000-0000000000b1', quantity=1)


def main() -> None:
    assert_test_database(os.environ)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from fastapi.testclient import TestClient

    from backend.app.main import app

    with TestClient(app) as client:
        seed(client)
        seed_portfolio(client)
    print(f'seed_ui_test: seeded {EMAIL} and {PORTFOLIO_EMAIL} in {os.environ["DB_DATABASE"]}')


if __name__ == '__main__':
    main()
