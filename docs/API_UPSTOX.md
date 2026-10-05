# API_UPSTOX — verified signatures (Oct 2026)

> **Preflight corrections (live calls, Sun 4 Oct 2026, ~13:00 IST).** Where this section disagrees with the
> text below, this section wins — every line was re-verified against the real API.
> - **Sandbox host is `https://api-sandbox.upstox.com`.** `sandbox.upstox.com` does not resolve (DNS
>   ENOTFOUND). The official SDK (`upstox-python/upstox_client/configuration.py`) uses
>   `api-sandbox.upstox.com` for `sandbox=True`. `POST /v3/order/place` with the sandbox token → 200
>   `{"data":{"order_ids":["261004130028974"]},"metadata":{"latency":4}}`.
> - **Trade history window:** `start_date=2023-04-01` → 400 `UDAPI1093`; `2024-04-01` → 200. Pagination is
>   under **`metaData.page`** (camelCase) — handle `metaData`, `meta_data` and `metadata`.
>   The demo account has **0 trades** in the window (all holdings predate it / IPO / demerger).
> - **`GLOBAL_INDICATOR|USDINR`** (name "USD INR", latency "20 Seconds", Sun 2:30 AM–Sat 1:30 AM IST) is
>   **rejected** by LTP v3 (`UDAPI100095`), LTP v2 / quotes v2 (`UDAPI1087`) and OHLC v3. It **works** with
>   historical candles v2/v3 (`/v3/historical-candle/GLOBAL_INDICATOR|USDINR/days/1/{to}/{from}` → daily
>   closes, e.g. 2026-10-02 close 96.30) and intraday candles v3 (empty on Sunday). Live FX therefore =
>   WebSocket tick if the feed delivers one, else latest intraday 1-minute candle close, else latest daily
>   close (labelled with its date). Never a typed rate.
> - **One invalid key fails the whole LTP v3 batch** (400). Validate keys against the instrument master
>   before batching. `BSE_EQ|<ISIN>` is valid for BSE-listed holdings (PAYTM BSE 1,664.80).
> - **Last trade time:** LTP v3 has none; full quote **v2** `GET /v2/market-quote/quotes?instrument_key=`
>   (Analytics token) returns `last_trade_time` (epoch-ms string), e.g. PAYTM `1790850575180` = Thu 1 Oct
>   15:59:35 IST (2 Oct was the Gandhi Jayanti holiday).
> - **Market status:** `GET /v2/market/status/NSE` (Analytics token OK) → `{"exchange":"NSE","status":"CLOSING_END"}`.
>   `GET /v2/market/holidays/{date}` and `/v2/market/timings/{date}` also work with the Analytics token.
> - **MTF margin is real:** `POST /v2/charges/margin` (OAuth) body
>   `{"instruments":[{"instrument_key":"NSE_EQ|INE982J01020","quantity":1,"transaction_type":"BUY","product":"MTF","price":1656}]}`
>   → `required_margin 522.7992` — exactly Upstox Pro's "Buy for ₹522.80/share with MTF". `product:"D"` → 1656.
>   Use it for the MTF row, the MTF multiplier badge, "With MTF" and the MTF card's "you pay"; when the OAuth
>   token is unavailable, hide those figures (never the reference's placeholder 0.3157).
> - **Index expiries** for the ticker ("Exp. 06 Oct") come from the instrument master: nearest `expiry` ≥ now
>   among `NSE_FO` rows with `underlying_symbol` NIFTY / BANKNIFTY and `BSE_FO` rows for SENSEX.
> - Positions `GET /v2/portfolio/short-term-positions` → `[]` (Pos. Total P&L 0.00). Profile
>   `GET /v2/user/profile` → `user_name` (avatar initials only; never render the name).
> - Feed authorize `GET /v3/feed/market-data-feed/authorize` → 200 JSON with
>   `data.authorized_redirect_uri` (wss://wsfeeder-api.upstox.com/…). Proto:
>   `https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto`. Standard users: 2 connections.
> - **The WebSocket feed DOES stream `GLOBAL_INDICATOR|USDINR`** (live test, Sun 4 Oct 13:22 IST, mode `ltpc`):
>   message 1 = `market_info` (`segmentStatus` e.g. `NSE_EQ: CLOSING_END`, `NCD_FO: NORMAL_CLOSE`); message 2 =
>   initial snapshot `{"GLOBAL_INDICATOR|USDINR":{"ltp":96.3,"ltt":1790960408000,"cp":96.31},
>   "NSE_EQ|INE982J01020":{"ltp":1656,"ltt":1790850575180,"cp":1678}, …}`. So live USD/INR = feed `ltpc.ltp`
>   (with `ltt`); candles are the fallback and the source for per-date closes.

Base `https://api.upstox.com`. Order placement v3 lives on `https://api-hft.upstox.com`.
Sandbox host is `https://api-sandbox.upstox.com` (see corrections above). All calls: `Accept: application/json`,
`Authorization: Bearer <token>`. Errors: `{"status":"error","errors":[{"errorCode":"UDAPIxxxx","message":...}]}`.
Rate limits: order APIs 10/s, 500/min, 2000/30min; other APIs 50/s, 500/min, 2000/30min; 429 on breach.

## Tokens
| Token | Env var | Lifetime | Used for |
|---|---|---|---|
| Analytics Token | `UPSTOX_ANALYTICS_TOKEN` | 1 year, read-only, GET only | market quotes, LTP v3, candles v3, WebSocket feed, instruments. Portfolio/trade endpoints ONLY from a whitelisted static IP — assume they will 401 from a laptop. |
| OAuth access token | `UPSTOX_ACCESS_TOKEN` | until 3:30 AM IST next day | holdings, trade history, positions, funds, trades-for-day, brokerage |
| Sandbox token | `UPSTOX_SANDBOX_TOKEN` | 30 days | place/modify/cancel order on the sandbox host only (no GTT, no reads) |

Token exchange (script `scripts/upstox-login.mjs`): `POST /v2/login/authorization/token`,
`Content-Type: application/x-www-form-urlencoded`, body `code, client_id, client_secret, redirect_uri, grant_type=authorization_code` → `access_token`.
Dialog: `GET /v2/login/authorization/dialog?client_id=&redirect_uri=&response_type=code`.

## Endpoints used

### Holdings — `GET /v2/portfolio/long-term-holdings` (OAuth)
Fields: `isin, instrument_token ("NSE_EQ|INE982J01020"), trading_symbol, company_name, exchange, product,
quantity, t1_quantity, average_price, last_price, close_price, pnl, day_change, day_change_percentage,
collateral_quantity, cnc_used_quantity`. Use `trading_symbol` (not deprecated `tradingsymbol`). Match on `isin`.

### Trade history — `GET /v2/charges/historical-trades` (OAuth)
Query: `segment=EQ`, `start_date=YYYY-MM-DD`, `end_date=YYYY-MM-DD`, `page_number` (≥1), `page_size` (1–5000).
Limit: last 3 financial years (UDAPI1093 beyond). Fields: `trade_date, transaction_type (BUY/SELL), price,
quantity, amount, isin, symbol, scrip_name, instrument_token, exchange, segment, trade_id`.
Pagination under `meta_data.page` (docs also write `metadata` — handle both). No order_id, no time-of-day.
Start date to use: first day of the FY three years back (e.g. `2023-04-01` on 4 Oct 2026).

### Trades for the day — `GET /v2/order/trades/get-trades-for-day` (OAuth) — include today's buys in Q.

### LTP v3 — `GET /v3/market-quote/ltp?instrument_key=NSE_EQ%7CINE982J01020,...` (Analytics)
Response `data` keyed `"NSE_EQ:PAYTM"` → `{ last_price, instrument_token, ltq, volume, cp }`.
Map back by `instrument_token`, not by key. `cp` = previous close. No `ltt` here.

### Full quote v3 — `GET /v3/market-quote/quotes?instrument_key=...` (Analytics) — `ohlc`, `depth`, `last_price`
(use only if you need depth; not required by the card).

### WebSocket feed v3 (Analytics)
1. `GET /v3/feed/market-data-feed/authorize` → follow the 302 / read `data.authorized_redirect_uri` (wss URL).
2. Connect with `ws`; send the subscription as **binary**: `{"guid":"<id>","method":"sub","data":{"mode":"ltpc","instrumentKeys":["NSE_EQ|INE982J01020"]}}`.
3. Decode with protobufjs using `MarketDataFeedV3.proto` (download from the feed doc page; keep a copy at
   `src/server/proto/MarketDataFeedV3.proto`). LTP path: `feeds[key].ltpc.{ltp, ltt, cp}`.
4. Expect `market_info` then snapshot then `live_feed`; outside market hours only heartbeats arrive — that is
   normal, keep the last LTP v3 value. Max 2 connections/user; reconnect with backoff.
Server-side only. Browser gets ticks via `GET /api/stream` (SSE).

### Historical candles v3 — `GET /v3/historical-candle/{instrument_key}/{unit}/{interval}/{to_date}/{from_date}` (Analytics)
`unit=days interval=1` for FX-on-date. Candle = `[timestamp, open, high, low, close, volume, oi]`.
Dates `YYYY-MM-DD`. Days history from 2000. Use the daily close on each Alpaca fill date for `fxOnBuyDate`.

### Instruments (public, no auth)
`https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz` (equities), `.../complete.json.gz`.
Equity key format `NSE_EQ|<ISIN>`. **Global instruments** (segment `GLOBAL_INDICATOR`, includes "USD INR"):
the file URL is on the Instruments doc page (https://upstox.com/developer/api-documentation/instruments/) —
`scripts/resolve-instruments.mjs` tries complete.json.gz first; if no `GLOBAL_INDICATOR` entries, WebFetch the
Instruments page, find the Global Instruments link, download, search `name` contains "USD INR" → key like
`GLOBAL_INDICATOR|<trading_symbol>`. Never hardcode the key. LTP v3 and candles v3 accept it.
Known ISINs: PAYTM `INE982J01020`, IRFC `INE053F01010`, TMPV `INE155A01022`, TMCV likely `INE1TAE01010` —
but ALWAYS resolve from holdings `isin` + NSE.json.gz; never trust the list.

### Brokerage — `GET /v2/charges/brokerage?instrument_token=&quantity=&product=D&transaction_type=BUY&price=` (OAuth)
Only used for the MTF "you pay" figure if needed; parse defensively (`data.charges.total`).

### Place order v3 (sandbox) — `POST https://api-sandbox.upstox.com/v3/order/place` (Sandbox token)
Body: `{"quantity":3,"product":"D","validity":"DAY","price":0,"tag":"addmorecheck","instrument_token":"NSE_EQ|INE982J01020","order_type":"MARKET","transaction_type":"BUY","disclosed_quantity":0,"trigger_price":0,"is_amo":false,"slice":false}`
Response `data.order_ids[]`. Live path (never used here) is `https://api-hft.upstox.com/v3/order/place`.
Sandbox does NOT support GTT (`/v3/order/gtt/place`) — the GTT tab uses the local confirmation sheet only.
Order APIs are down 12:00–5:30 AM IST (UDAPI100074) — expect this overnight; the flag fallback must handle it silently.

## Instrument key for a holding
`holding.instrument_token` already is the key (`NSE_EQ|<ISIN>`). For watchlist stocks not held, resolve via
NSE.json.gz by `trading_symbol`.
