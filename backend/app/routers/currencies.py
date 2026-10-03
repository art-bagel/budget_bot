from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.storage import ledger, reports
from backend.app.services.fx_rates import fx_rates


router = APIRouter(prefix='/api/v1/currencies', tags=['currencies'])


class CurrencyItem(BaseModel):
    code: str
    name: str
    scale: int


@router.get('', response_model=List[CurrencyItem])
async def get_currencies() -> list:
    return await reports.get__currencies()


class FxRatesResponse(BaseModel):
    source: str
    rate_date: str
    fetched_at: str
    rub_per_unit: dict[str, float]


@router.get('/rates', response_model=FxRatesResponse)
async def get_currency_rates() -> dict:
    try:
        return await fx_rates.get(reports, ledger)
    except Exception as exc:
        raise HTTPException(status_code=503, detail='Курсы валют временно недоступны') from exc
