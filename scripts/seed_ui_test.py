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


def seed(client) -> None:
    """
    Fills the account with fictional RUB money, budget categories, a credit and a crypto position.
    :param client: TestClient of the application.
    """
    def call(method: str, url: str, **kwargs):
        response = client.request(method, url, **kwargs)
        if response.status_code >= 400:
            raise SystemExit(f'seed_ui_test: {method} {url} -> {response.status_code} {response.text}')
        return response.json()

    session = call('POST', '/api/v1/auth/signup', json={
        'email': EMAIL, 'password': PASSWORD, 'base_currency_code': 'RUB',
        'invite_code': os.environ['SIGNUP_INVITE_CODE'],
    })
    client.headers['Authorization'] = f"Bearer {session['token']}"
    context = call('GET', '/api/v1/auth/context')
    account = context['bank_account_id']
    unallocated = context['unallocated_category_id']

    call('POST', '/api/v1/operations/income', json={
        'bank_account_id': account, 'amount': 150000, 'currency_code': 'RUB',
        'comment': 'Зарплата', 'operated_at': '2026-01-05',
    })
    for name, budget, spent in (('Продукты', 30000, 8450), ('Транспорт', 6000, 1200), ('Кафе', 8000, 2350)):
        category = call('POST', '/api/v1/categories', json={'name': name, 'kind': 'regular'})['id']
        call('POST', '/api/v1/operations/allocate', json={
            'from_category_id': unallocated, 'to_category_id': category, 'amount_in_base': str(budget),
        })
        call('POST', '/api/v1/operations/expense', json={
            'bank_account_id': account, 'category_id': category, 'amount': str(spent),
            'currency_code': 'RUB', 'operated_at': '2026-01-10',
        })

    call('POST', '/api/v1/bank-accounts/credit', json={
        'name': 'Тестовая кредитка', 'credit_kind': 'credit_card', 'currency_code': 'RUB',
        'credit_limit': 50000, 'interest_rate': 24.9, 'payment_day': 15,
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


def main() -> None:
    assert_test_database(os.environ)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from fastapi.testclient import TestClient

    from backend.app.main import app

    with TestClient(app) as client:
        seed(client)
    print(f'seed_ui_test: seeded {EMAIL} in {os.environ["DB_DATABASE"]}')


if __name__ == '__main__':
    main()
