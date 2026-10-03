"""Currency reserves refresh FX on demand and retain saved valuation on failure."""
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

os.environ.setdefault('APP_PORT', '8000')
os.environ.setdefault('DB_PORT', '5432')

from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import portfolio  # noqa: E402


def summary(kind='currency', value=9000):
    return dict(
        investment_account_id=5, investment_asset_type=kind,
        investment_account_name='Reserve', investment_account_owner_type='user',
        investment_account_owner_name='Test', cash_balance_in_base=8000,
        cash_market_value_in_base=value, cash_valuation_complete=value is not None,
        currency_balances=[dict(currency_code='USD', amount=100, historical_cost_in_base=8000,
                               base_currency_code='RUB', market_value_in_base=value)],
        invested_principal_in_base=0, realized_income_in_base=0,
        position_contributed_in_base=0, position_returned_in_base=0,
        net_contributed_in_base=8000, gross_contributed_in_base=8000,
        gross_withdrawn_in_base=0, open_positions_count=0,
    )


class CurrencyReserveApiTests(unittest.IsolatedAsyncioTestCase):
    async def request(self):
        app = FastAPI()
        app.include_router(portfolio.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=1)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            return await client.get('/api/v1/portfolio/summary')

    async def test_refresh_returns_new_valuation_without_changing_basis(self):
        with patch.object(portfolio.reports, 'get__portfolio_summary', AsyncMock(side_effect=[
            [summary(value=8500)], [summary(value=9000)],
        ])) as report, patch.object(portfolio.fx_rates, 'get', AsyncMock()) as refresh:
            response = await self.request()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()[0]['cash_market_value_in_base'], 9000)
            self.assertEqual(response.json()[0]['cash_balance_in_base'], 8000)
            self.assertEqual(response.json()[0]['currency_balances'][0]['amount'], 100)
            self.assertEqual(report.await_count, 2)
            refresh.assert_awaited_once()

    async def test_failed_refresh_keeps_saved_values_and_missing_quote_flag(self):
        for value in (8500, None):
            with patch.object(portfolio.reports, 'get__portfolio_summary', AsyncMock(return_value=[summary(value=value)])), patch.object(portfolio.fx_rates, 'get', AsyncMock(side_effect=ValueError('offline'))):
                response = await self.request()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()[0]['cash_valuation_complete'], value is not None)
                self.assertEqual(response.json()[0]['cash_market_value_in_base'], value)

    async def test_existing_account_does_not_request_fx(self):
        with patch.object(portfolio.reports, 'get__portfolio_summary', AsyncMock(return_value=[summary('other')])), patch.object(portfolio.fx_rates, 'get', AsyncMock()) as refresh:
            self.assertEqual((await self.request()).status_code, 200)
            refresh.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
