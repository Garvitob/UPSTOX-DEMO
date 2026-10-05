# API_MAP — every value on screen → app route → upstream endpoint → fields → token

Nothing on screen is computed from a constant. Each figure is either an upstream field or a pure function
(`src/lib/compute.ts`, unit-tested) of upstream fields. Tokens stay on the server (`src/server/env.ts`). The browser
only calls the app's own `/api/*` routes.

Tokens: **A** = `UPSTOX_ANALYTICS_TOKEN` (market data, 1 year) · **O** = `UPSTOX_ACCESS_TOKEN` (daily OAuth, account
data) · **S** = `UPSTOX_SANDBOX_TOKEN` (sandbox orders only) · **AP** = Alpaca paper keys (`ALPACA_KEY_ID` /
`ALPACA_SECRET_KEY`) · **—** = public file, no token.

## Add-More Check card — India (Regular / GTT)

| Card element | Computation | App route | Upstream endpoint · fields | Token |
|---|---|---|---|---|
| `Q` held shares (Shares row "before") | `quantity + t1_quantity` + today's net delivery buy, or − min(today's net delivery sell, `cnc_used_quantity`) (`withToday`, CPO Q1) | `/api/holdings` | `GET api.upstox.com/v2/portfolio/long-term-holdings` · `quantity`, `t1_quantity`, `cnc_used_quantity`; `GET /v2/order/trades/get-trades-for-day` · `product` (D only), `transaction_type`, `quantity`, `average_price`, `instrument_token`, `trade_id` | O (cache fallback) |
| "incl. 3 bought today" / "after 2 sold today" / "excl. today's trades (unavailable)" | today's net delivery trade of this ISIN, merged only when fetched on the Holdings snapshot's IST day; de-duplicated against Trade History by `trade_id` | `/api/holdings` (`today`) | get-trades-for-day (as above) | O (cache fallback) |
| "incl. N settling" | `t1_quantity` | `/api/holdings` | same · `t1_quantity` | O |
| `A` average (Average price "before", header "Avg ₹…") | Upstox's own FIFO average; only a net buy today blends in at the day's weighted buy price: (Qh·A + n·p̄)/(Qh + n) | `/api/holdings` | same · `average_price` | O |
| `L` live price | LTP v3 snapshot, then feed ticks | `/api/ltp`, `/api/stream` | `GET api.upstox.com/v3/market-quote/ltp` · `last_price`, `cp`; WebSocket `wss://…/market-data-feeder/v3` (via `GET /v3/feed/market-data-feed/authorize`) · `feeds[key].ltpc.{ltp,ltt,cp}` | A |
| `p` order price | Market → `L`; Limit → typed; GTT → typed trigger | — | ticket input | — |
| GTT default trigger | `L × (1 − 0.25 %)` rounded to tick (`defaultTrigger`) | `/api/instruments` | `assets.upstox.com/…/complete.json.gz` · `tick_size` | — |
| New average, lead sentence | `(Q·A + q·p)/(Q+q)` (`computeIndia`) | — | — | — |
| Break-even line | `A/ref − 1`, `newAvg/ref − 1`; `ref = L`, or the trigger on GTT | — | — | — |
| "A 10% move is worth" | `0.10·Q·ref` → `0.10·(Q+q)·ref` | — | — | — |
| "puts ₹X more into …" | `q·p` | — | — | — |
| Chain "Buys so far" + dates + "Nth buy" | net BUY rows per `trade_date` since the position was last flat (`buyHistory`). One lot per day: the API has no order id. | `/api/trades?isin=` | `GET api.upstox.com/v2/charges/historical-trades?segment=EQ&start_date=&end_date=&page_number=&page_size=5000` · `trade_date`, `transaction_type`, `price`, `quantity`, `isin`; pagination `metaData.page.total_pages` | O (cache fallback) |
| "since Apr 2024" | `start_date` actually accepted (2023-04-01 → UDAPI1093 → 2024-04-01) | `/api/trades` | same (window) | O |
| "No buys in your Upstox trade history since …" | zero BUY rows for the ISIN in the window | `/api/trades` | same | O |

## MTF variant

| Card element | Computation | App route | Upstream | Token |
|---|---|---|---|---|
| "Buy for ₹X/share with MTF", badge "3.2X" | Margin API for **1 share** at `L`; multiplier = `price / margin` | `/api/margin?key=&price=` | `POST api.upstox.com/v2/charges/margin` body `{instruments:[{instrument_key, quantity:1, transaction_type:"BUY", product:"MTF", price}]}` · `data.required_margin` | O |
| "you pay ₹X", footer "With MTF: ₹ X" | per-share margin ÷ price × `q·p` (linear; confirmed by Upstox Pro's own "With MTF") | `/api/margin` | same | O |
| Delivery shares / blended cost | `Q`, `A`, `newAvg` | `/api/holdings` | as above | O |

## Re-entry card (sold out earlier)

| Element | Computation | App route | Upstream | Token |
|---|---|---|---|---|
| "You sold N shares at ₹P on D" | last net SELL day of a not-held ISIN (`soldOut`) | `/api/trades?isin=` | historical-trades · `transaction_type`, `price`, `quantity`, `trade_date` | O |
| "Today's price … lower/higher (±x%)" | `L − P`, `L/P − 1` | `/api/ltp` | LTP v3 · `last_price` | A |

There is no real sold-out symbol in this account (0 trades in the window), so the re-entry card is implemented and
unit-tested but never rendered. Nothing is seeded.

## US card (Alpaca paper + Upstox USD/INR)

| Element | Computation | App route | Upstream | Token |
|---|---|---|---|---|
| `Q`, `A` ($) | Alpaca position | `/api/us/positions` | `GET paper-api.alpaca.markets/v2/positions` · `qty`, `avg_entry_price` | AP |
| "Awaiting first fill (orders placed D)" | open buy orders, no position | `/api/us/positions` | `GET /v2/orders?status=open&symbols=` · `created_at`, `side`, `status` | AP |
| Buy lots + chain | fills grouped per order and IST day (`usBuyHistory`) | `/api/us/fills?symbol=` | `GET /v2/account/activities?activity_types=FILL` · `transaction_time`, `price`, `qty`, `side`, `order_id` | AP |
| `p` price, day change | latest IEX trade; previous daily bar | `/api/us/price?symbol=` | `GET data.alpaca.markets/v2/stocks/{sym}/snapshot?feed=iex` · `latestTrade.p/t`, `prevDailyBar.c`; `/v2/assets/{sym}` · `exchange`; `/v2/clock` · `is_open`, `next_open` | AP |
| `fxNow` ("today ₹X/$", chip "Live USD/INR (Upstox GLOBAL_INDICATOR\|USDINR)") | Upstox feed tick for `GLOBAL_INDICATOR\|USDINR` → else intraday 1-min candle → else latest daily close (labelled) | `/api/fx` | WebSocket feed `ltpc.ltp`; `GET /v3/historical-candle/intraday/{key}/minutes/1`; `GET /v3/historical-candle/{key}/days/1/{to}/{from}` · close | A |
| FX on each buy date | US lot date = the IST calendar date of the Alpaca fill; its rate = the Upstox USD/INR daily close for that date (the live rate while that date is still open; the previous close, printed "(D Mon close)", when the date has no candle). A fill after 14:30 ET (13:30 ET in winter) falls after midnight IST and takes the next IST day's close. | `/api/fx?date=` | historical candles v3 · `[ts, o, h, l, close, …]` | A |
| FX chip "USD/INR (Upstox GLOBAL_INDICATOR\|USDINR) · as of Fri 22:30 IST" | the key and time of the rate actually used (CPO Q2) | `/api/fx` | `instrument_key`, `basis`, `as_of` | A |
| ₹ average, returns, "why they differ", 10% move in ₹ | `computeUS` (SPEC formulas, FIFO-held lots, unavailable → labelled notice) | — | — | — |

## Shell (holdings page replica)

| Element | Source | App route | Upstream | Token |
|---|---|---|---|---|
| Ticker NIFTY 50 / BANKNIFTY / SENSEX + change | LTP v3 `last_price`, `cp` | `/api/ltp` | LTP v3 | A |
| "Exp. 06 Oct" | nearest `expiry` ≥ now for NSE_FO NIFTY/BANKNIFTY, BSE_FO SENSEX | `/api/instruments` | `complete.json.gz` · `expiry`, `underlying_symbol` | — |
| Hol. Total P&L | Σ (L − A)·Q over holdings | `/api/holdings` + `/api/ltp` | as above | O + A |
| Pos. Total P&L | Σ `pnl` | `/api/holdings` | `GET /v2/portfolio/short-term-positions` · `pnl` | O (cache fallback) |
| Avatar initials | initials of `user_name` (name never leaves the server) | `/api/holdings` | `GET /v2/user/profile` · `user_name` | O (cache fallback) |
| Holdings table / summary | Q, A from holdings; L, cp from LTP | `/api/holdings`, `/api/ltp` | as above | O + A |
| Holdings "Invested" (row + summary) | `(quantity + t1_quantity) × last_price − pnl` of the same Holdings snapshot (Upstox's unrounded average: TMCV 15 × 415.50 − 1,367.49 = 4,865.01), + this session's local buys `q × p` (`holdingInvested`) | `/api/holdings` | long-term-holdings · `quantity`, `t1_quantity`, `last_price`, `pnl` | O (cache fallback) |
| Watchlist names | `data/watchlist.json` (your Upstox screenshot — Upstox has no watchlist API) | `/api/instruments` | keys from `complete.json.gz` | — |
| Watchlist prices | LTP v3 + feed | `/api/ltp`, `/api/stream` | as above | A |
| NSE / BSE price in the ticket | `NSE_EQ\|ISIN`, `BSE_EQ\|ISIN` LTP | `/api/ltp` | LTP v3 | A |
| "Last traded Thu 15:59" | `last_trade_time` / feed `ltt` | `/api/ltp?ltt=1` | feed snapshot `ltpc.ltt`; `GET /v2/market-quote/quotes` · `last_trade_time` | A |
| "Markets are closed …" note, price chip "NSE closed · …" / "BSE closed · …" / "Live BSE price" | the status of the exchange the ticket trades on ≠ `NORMAL_OPEN` | `/api/ltp` (`markets.NSE`, `markets.BSE`), `/api/stream` (`market` events NSE_EQ / BSE_EQ) | `GET /v2/market/status/NSE` and `/BSE` · `status`; feed `marketInfo.segmentStatus` | A |

## Place Order panel (Upstox Pro flow: Buy / Sell → exchange → panel)

| Element | Source | App route | Upstream · fields | Token |
|---|---|---|---|---|
| "Exchange to Buy From" options: NSE / BSE price and "-22.00(-1.31%)" | each exchange's instrument key (NSE_EQ\|ISIN, BSE_EQ\|ISIN from the instrument master), LTP and previous close | `/api/ltp`, `/api/stream` | LTP v3 · `last_price`, `cp`; feed `ltpc` | A |
| "Required: ₹ 1656.00" | the Margin API for the exact order (instrument, quantity, BUY/SELL, product D or MTF, price) | `/api/margin?key=&price=&qty=&side=&product=` | `POST /v2/charges/margin` · `data.required_margin` (BUY D 1 @ 1656 → 1656.0, SELL D → 0.0) | O |
| "Available: ₹ 0.00", "You've insufficient funds … add funds", "Add funds" | equity available margin; shown when Required > Available on a Regular/MTF BUY | `/api/funds` | `GET /v2/user/get-funds-and-margin?segment=SEC` · `data.equity.available_margin` | O |
| Chip "Upstox funds service closed · opens 5:30 AM IST", "Available: —" | the Funds API's own error: 423 `UDAPI100072` "The Funds service is accessible from 5:30 AM to 12:00 AM IST daily" (the opening time is read from that message); no BUY is blocked while the balance is unknown | `/api/funds` | same · `errors[0].errorCode`, `message` | O |
| GTT "Place order · If price is below/above", "₹ trigger ⇄ %" | % = |L − T| / L; typing a % sets T = L × (1 ∓ %) rounded half-up to the tick (`triggerAtPct`, `pctFromTrigger`) | `/api/ltp`, `/api/instruments` | LTP v3 · `last_price`; `complete.json.gz` · `tick_size` | A |
| "With MTF: ₹ 521.50" (GTT) | MTF margin per share × order value, from the Margin API | `/api/margin` (product MTF) | as above | O |

## Order flow

| Element | Source | App route | Upstream | Token |
|---|---|---|---|---|
| Sandbox order id on the receipt | `ENABLE_SANDBOX_ORDER=true`, Regular/MTF only | `POST /api/order` | `POST https://api-sandbox.upstox.com/v3/order/place` · `data.order_ids[0]` | S |
| Receipt figures | `indiaReceipt` / `usReceipt` from the same inputs as the card | — | — | — |
| "updated locally" (chip, table tag, "(updated locally)" after the buy date in the chain) | the confirmed order's `q` and `p`, kept in this browser only; its Day P&L is (L − p)·q, outside the previous-close base. Production re-fetches holdings after the fill. | — | — | — |
