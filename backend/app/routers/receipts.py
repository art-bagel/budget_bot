import logging
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Set

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.app.config import RECEIPT_SCAN_API_URL, RECEIPT_SCAN_MODEL, settings
from backend.app.dependencies import CurrentUser, get_current_user
from backend.app.services.receipt_scan import ReceiptScan, ReceiptScanError, scan_receipt
from backend.app.storage import context


logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/v1/receipts', tags=['receipts'])

MAX_JPEG_BYTES = 3 * 1024 * 1024
LIMIT_PER_HOUR = 20
BAD_IMAGE = 'Нужна фотография в формате JPEG до 3 МБ'

# ponytail: in-process limiter (uvicorn runs one worker) that resets on restart;
# total spend is capped by the per-user flag and the key budget at the provider.
_calls: Dict[int, Deque[float]] = defaultdict(deque)
_in_flight: Set[int] = set()


def _reserve(user_id: int) -> None:
    """
    Checks and takes a model call slot in one synchronous step, so concurrent
    requests cannot all pass the check before any of them is counted.
    Every model call counts, failed ones too: they are already paid for.
    """
    if user_id in _in_flight:
        raise HTTPException(status_code=429, detail='Чек уже распознаётся')
    now = time.monotonic()
    calls = _calls[user_id]
    while calls and now - calls[0] >= 3600:
        calls.popleft()
    if len(calls) >= LIMIT_PER_HOUR:
        raise HTTPException(status_code=429, detail='Слишком много чеков подряд, попробуйте через час')
    calls.append(now)
    _in_flight.add(user_id)


async def _read_jpeg(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_JPEG_BYTES:
            raise HTTPException(status_code=422, detail=BAD_IMAGE)
    if not body.startswith(b'\xff\xd8\xff'):
        raise HTTPException(status_code=422, detail=BAD_IMAGE)
    return bytes(body)


@router.post('/scan', response_model=ReceiptScan)
async def scan(request: Request, user: CurrentUser = Depends(get_current_user)) -> ReceiptScan:
    """
    Распознаёт фото чека и возвращает предложение для формы расхода.

    Тело — сырой JPEG. Параметра тела у обработчика нет намеренно: так FastAPI
    не читает тело до проверки входа. В базу ничего не пишется.
    """
    user_context = await context.get__user_context(user.user_id)
    if not user_context or not user_context.get('receipt_scan_enabled'):
        raise HTTPException(status_code=403, detail='Распознавание чеков недоступно')
    if not settings.receipt_scan_api_key:
        raise HTTPException(status_code=503, detail='Распознавание чеков не настроено')

    jpeg = await _read_jpeg(request)
    _reserve(user.user_id)
    started = time.monotonic()
    try:
        return await scan_receipt(
            jpeg,
            api_url=RECEIPT_SCAN_API_URL,
            api_key=settings.receipt_scan_api_key,
            model=RECEIPT_SCAN_MODEL,
        )
    except ReceiptScanError as exc:
        # WARNING: uvicorn leaves module loggers at the default level, INFO is dropped.
        logger.warning(
            'Receipt scan failed for user %s: model=%s cause=%s after %.1fs',
            user.user_id, RECEIPT_SCAN_MODEL, exc.reason, time.monotonic() - started,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from None
    finally:
        _in_flight.discard(user.user_id)
