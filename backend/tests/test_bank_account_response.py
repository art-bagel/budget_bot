"""Existing collection accounts must not break the account-list response."""

import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

os.environ.setdefault('APP_PORT', '8000')
os.environ.setdefault('DB_PORT', '5432')

from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import bank_accounts  # noqa: E402


class BankAccountResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_collection_accounts_are_serialized_for_page_loads(self):
        app = FastAPI()
        app.include_router(bank_accounts.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
        account = dict(
            id=5, name='Collection', owner_type='user', owner_user_id=1,
            owner_name='Test', account_kind='investment', investment_asset_type='collectible',
            is_primary=False, is_active=True, created_at='2026-10-03T00:00:00+00:00',
        )
        with patch.object(bank_accounts.reports, 'get__bank_accounts', AsyncMock(return_value=[account])):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url='http://test',
            ) as client:
                for query in ('', '?account_kind=investment', '?account_kind=investment&include_archived=true'):
                    response = await client.get('/api/v1/bank-accounts' + query)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()[0]['investment_asset_type'], 'collectible')


if __name__ == '__main__':
    unittest.main()
