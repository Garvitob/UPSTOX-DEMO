# API_ALPACA — paper trading (verified Oct 2026)

Trading base `https://paper-api.alpaca.markets`; market data base `https://data.alpaca.markets`.
Headers on every call: `APCA-API-KEY-ID: <ALPACA_KEY_ID>`, `APCA-API-SECRET-KEY: <ALPACA_SECRET_KEY>`.
Paper keys are separate from live keys; same API shape. All numeric fields arrive as strings.

## Positions — `GET /v2/positions`
`symbol, qty, avg_entry_price, cost_basis, market_value, current_price, lastday_price, unrealized_pl,
unrealized_plpc, side, asset_id, exchange`. `avg_entry_price` is a weighted average intraday and
"compressed FIFO" after the end-of-day sync — it can change overnight; show `as of <time>`.

## Fills — `GET /v2/account/activities/FILL` (or `/v2/account/activities?activity_types=FILL`)
`activity_type, transaction_time (ISO), type (fill|partial_fill), price, qty, side, symbol, cum_qty, order_id, id`.
Paginate with `page_token=<last id>`. Buys for the US card = `side=buy` rows for the symbol, oldest first.

## Latest price — `GET /v2/stocks/{symbol}/trades/latest?feed=iex`
`{ symbol, trade: { t, p, s, x } }` → `p` is the price. Free/paper accounts: IEX feed only (`feed=sip` → error 42210000).
Daily bars (optional): `GET /v2/stocks/{symbol}/bars?timeframe=1Day&feed=iex&start=YYYY-MM-DD` → `bars[].{t,o,h,l,c,v}`.

## Orders — `POST /v2/orders` (used only by `scripts/alpaca-seed-orders.mjs`)
Market buy: `{"symbol":"AAPL","qty":"1","side":"buy","type":"market","time_in_force":"day"}` → fills at the
next regular session open (9:30 ET = 7:00 PM IST).
Extended-hours buy: `{"symbol":"AAPL","qty":"1","side":"buy","type":"limit","limit_price":"<~1% above last>","time_in_force":"day","extended_hours":true}`
→ eligible from the overnight session that opens the trade date (Sun/weekday 8:00 PM ET = 5:30 AM IST next day; Alpaca
24/5 trading, on by default — `disable_overnight_trading: false` on this account), then pre-market from 4:00 AM ET
(1:30 PM IST). Only `limit` + `day`/`gtc` is accepted with `extended_hours`; only limit orders trade overnight. Weekend
orders queue for the next session.
Fractional qty allowed (min $1 notional); `fractionable` flag on `/v2/assets/{symbol}`.

## FX for the US card
Live USD/INR and per-date USD/INR come from **Upstox** (global indicator via LTP v3 and daily candles v3), see
`docs/API_UPSTOX.md`. Alpaca has no INR data. If the Upstox key is unresolved, the US tab shows
`USD/INR feed unavailable` — never a typed rate.
