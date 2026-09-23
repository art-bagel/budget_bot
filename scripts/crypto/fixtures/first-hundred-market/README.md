# Historical reference data

Public market responses retrieved 2026-09-23. No wallet addresses or personal
transactions are included. Preserve raw bytes for SHA-256 provenance.

- `cbr-usd.xml`: https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/06/2024&date_req2=31/07/2024&VAL_NM_RQ=R01235
- `gram-<timestamp-ms>.json`: https://api.bybit.com/v5/market/kline with
  `category=spot&symbol=GRAMUSDT&interval=1&start=<timestamp-ms>&end=<timestamp-ms+59999>&limit=1`.
- API semantics: https://bybit-exchange.github.io/docs/v5/market/kline
- Identity: https://announcements.bybit.com/en/article/bybit-toncoin-ton-gram-gram--blt617f4bf48950ab77/

Bybit now exposes TON history under GRAMUSDT following its ticker change.
Rows must match the requested 2024 minute exactly. The minute opening quote is
an estimate of market value, not the user's execution price. Conversion to RUB
assumes reference parity of USDT/USD and uses the effective CBR rate for the
Moscow calendar date. None of these estimates replaces actual RUB purchase costs.
