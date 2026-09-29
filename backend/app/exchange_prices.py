"""Display-only quotes for non-TON coins while CoinGecko refuses the server.

Bybit spot gives the coin in USDT; TonAPI's rate of USDT (TON master) converts
it to RUB/USD/EUR. TON-network and Telegram Wallet coins are priced by their
jetton master in ton_prices, never here by ticker.
"""

import logging
import math
from datetime import datetime, timedelta, timezone

import httpx

from backend.app.ton_prices import token_prices

logger = logging.getLogger(__name__)
BYBIT_PAIRS = {"ETH": "ETHUSDT", "USDC": "USDCUSDT"}
USDT_TON = dict(
    id=0,
    symbol="USDT",
    network_code="ton",
    contract_address="0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe",
)
CACHE: dict[str, tuple[datetime, float]] = {}
TTL = timedelta(minutes=2)
MAX_AGE = timedelta(minutes=30)


async def bybit_prices(assets: list[dict], currency: str) -> list[dict]:
    wanted: dict[str, list[dict]] = {}
    for asset in assets:
        pair = BYBIT_PAIRS.get(str(asset.get("symbol")))
        if pair and asset.get("network_code") not in ("ton", "telegram"):
            wanted.setdefault(pair, []).append(asset)
    if not wanted:
        return []
    usdt = await token_prices([USDT_TON], currency)
    if not usdt:
        return []
    now = datetime.now(timezone.utc)
    pending = [p for p in wanted if p not in CACHE or now - CACHE[p][0] > TTL]
    if pending:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                for pair in pending:
                    response = await client.get(
                        "https://api.bybit.com/v5/market/tickers",
                        params={"category": "spot", "symbol": pair},
                    )
                    response.raise_for_status()
                    rows = (response.json().get("result") or {}).get("list") or []
                    price = float(rows[0]["lastPrice"]) if rows else math.nan
                    if math.isfinite(price) and price > 0:
                        CACHE[pair] = (datetime.now(timezone.utc), price)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            logger.warning("Bybit quote request failed: %s", exc)
    result = []
    now = datetime.now(timezone.utc)
    for pair, items in wanted.items():
        cached = CACHE.get(pair)
        if not cached or now - cached[0] > MAX_AGE:
            continue
        at = min(cached[0], datetime.fromisoformat(usdt[0]["fetched_at"]))
        stale = now - at > TTL
        for asset in items:
            result.append(
                dict(
                    crypto_asset_id=int(asset["id"]),
                    symbol=str(asset["symbol"]),
                    vs_currency=currency.upper(),
                    price=cached[1] * usdt[0]["price"],
                    source="bybit_stale" if stale else "bybit",
                    fetched_at=at.isoformat(),
                    is_stale=stale,
                    stale_age_seconds=int((now - at).total_seconds()) if stale else None,
                )
            )
    return result
