from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from backend.app.storage import reports


router = APIRouter(prefix='/api/v1/currencies', tags=['currencies'])


class CurrencyItem(BaseModel):
    code: str
    name: str
    scale: int


@router.get('', response_model=List[CurrencyItem])
async def get_currencies() -> list:
    return await reports.get__currencies()
