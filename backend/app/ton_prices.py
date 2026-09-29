"""Display-only TonAPI quotes keyed by mainnet master address, never by ticker.

The native coin has no master; it is the asset (TON, ton, '') — (GRAM, ton, '')
after the rebrand — which uq_crypto_assets_identity keeps unique. TonAPI quotes
it under either name.
"""

import base64
import binascii
import logging
import math
import re
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)
CACHE: dict[tuple[str, str], tuple[datetime, float]] = {}
TTL = timedelta(minutes=2)
MAX_AGE = timedelta(minutes=30)
# Telegram Wallet holds these as TON jettons; masters are TonAPI-whitelisted.
# Keyed by the exact service identity the import writes, not by ticker.
TELEGRAM_WALLET_JETTONS = {
    "service:telegram:DOGS": "0:afc49cb8786f21c87045b19ede78fc6b46c51048513f8e9a6d44060199c1bf0c",
    "service:telegram:MAJOR": "0:ae3e6d351e576276e439e7168117fd64696fd6014cb90c77b2f2cbaacd4fcc00",
    "service:telegram:HMSTR": "0:09f2e59dec406ab26a5259a45d7ff23ef11f3e5c7c21de0b0d2a1cbe52b76b3d",
}


def master_address(asset: dict) -> str | None:
    if asset.get("network_code") == "telegram":
        return TELEGRAM_WALLET_JETTONS.get(asset.get("contract_address"))
    if asset.get("network_code") != "ton":
        return None
    address = asset.get("contract_address")
    if not isinstance(address, str):
        return None
    if address == "" and asset.get("symbol") in ("TON", "GRAM"):
        return asset["symbol"]
    if re.fullmatch(r"(0|-1):[0-9a-fA-F]{64}", address):
        return address.lower()
    if not re.fullmatch(r"[A-Za-z0-9_+/\-]{48}", address):
        return None
    try:
        data = base64.urlsafe_b64decode(address)
    except (ValueError, binascii.Error):
        return None
    # Reject testnet addresses and invalid checksum/tag rather than price another token.
    if len(data) != 36 or data[0] not in (0x11, 0x51):
        return None
    if binascii.crc_hqx(data[:34], 0).to_bytes(2, "big") != data[34:]:
        return None
    wc = int.from_bytes(data[1:2], "big", signed=True)
    return f"{wc}:{data[2:34].hex()}" if wc in (0, -1) else None


async def token_prices(assets: list[dict], currency: str) -> list[dict]:
    currency = currency.upper()
    if currency not in ("RUB", "USD", "EUR"):
        return []
    mapped: dict[str, list[dict]] = {}
    for asset in assets:
        address = master_address(asset)
        if address:
            mapped.setdefault(address, []).append(asset)
    if not mapped:
        return []
    now = datetime.now(timezone.utc)
    pending = [
        a
        for a in mapped
        if (a, currency) not in CACHE or now - CACHE[a, currency][0] > TTL
    ]
    if pending:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                # Bound batches to avoid unbounded URLs on a large asset registry.
                for offset in range(0, len(pending), 50):
                    batch = pending[offset : offset + 50]
                    response = await client.get(
                        "https://tonapi.io/v2/rates",
                        params={
                            "tokens": ",".join(batch),
                            "currencies": currency.lower(),
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    rates = (
                        payload.get("rates", {}) if isinstance(payload, dict) else {}
                    )
                    if not isinstance(rates, dict):
                        continue
                    for address in batch:
                        item = rates.get(address)
                        prices = item.get("prices") if isinstance(item, dict) else None
                        price = (
                            prices.get(currency) if isinstance(prices, dict) else None
                        )
                        if (
                            isinstance(price, (int, float))
                            and not isinstance(price, bool)
                            and math.isfinite(price)
                            and price > 0
                        ):
                            CACHE[address, currency] = (
                                datetime.now(timezone.utc),
                                float(price),
                            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("TonAPI quote request failed: %s", exc)
    result = []
    now = datetime.now(timezone.utc)
    for address, items in mapped.items():
        cached = CACHE.get((address, currency))
        if not cached or now - cached[0] > MAX_AGE:
            continue
        at, price = cached
        stale = now - at > TTL
        for asset in items:
            result.append(
                dict(
                    crypto_asset_id=int(asset["id"]),
                    symbol=str(asset["symbol"]),
                    vs_currency=currency,
                    price=price,
                    source="tonapi_stale" if stale else "tonapi",
                    fetched_at=at.isoformat(),
                    is_stale=stale,
                    stale_age_seconds=int((now - at).total_seconds())
                    if stale
                    else None,
                )
            )
    return result
