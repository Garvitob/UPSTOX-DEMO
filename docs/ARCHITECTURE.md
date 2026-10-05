# ARCHITECTURE

## Stack
Next.js 14 App Router, TypeScript strict, Tailwind (layout utilities only), plain CSS ported from
`reference/add-more-check-demo.html` for the Upstox replica, `vitest` (compute engine), `ws` +
`protobufjs` (Upstox feed, server-side), SSE to the browser. No database. Node 20+.

## Folder layout (create exactly this)
```
src/
  app/
    layout.tsx, page.tsx, globals.css          # replica shell, Inter font
    api/
      holdings/route.ts        # GET → holdings (live if OAuth valid, else cache) + source meta
      trades/route.ts          # GET ?isin= → BUY/SELL history for ISIN (live/cache) + window dates
      ltp/route.ts             # GET ?keys=a,b → LTP v3 (Analytics)
      stream/route.ts          # GET → SSE of {key, ltp, ltt} from the server WS client
      instruments/route.ts     # GET → resolved keys from data/instruments.json (+ resolve on demand)
      fx/route.ts              # GET → live USD/INR; ?date=YYYY-MM-DD → daily close
      us/positions/route.ts    # GET → Alpaca positions
      us/fills/route.ts        # GET ?symbol= → Alpaca buy fills (oldest first)
      us/price/route.ts        # GET ?symbol= → latest trade price (iex)
      order/route.ts           # POST → sandbox place (flag) → {ok, order_id?} ; never throws to UI
  server/
    env.ts                     # typed env access; throws clear errors for missing keys
    upstox.ts                  # fetch wrapper: base URLs, headers, 429 backoff, 401 detection
    upstoxFeed.ts              # singleton WS client, protobuf decode, in-memory LTP map, subscribers
    alpaca.ts                  # fetch wrapper
    cache.ts                   # read/write data/cache/*.json with fetched_at; "live or cache" helper
    instruments.ts             # NSE.json.gz + global instruments loader/resolver (memoised)
    proto/MarketDataFeedV3.proto
  lib/
    compute.ts                 # pure functions from docs/SPEC.md (India + US) — unit tested
    format.ts                  # inr(), usd(), pct(), nth()
    copy.ts                    # every string on the card, built from compute outputs (SPEC copy)
    types.ts
  components/
    Shell/*                    # ticker, topbar, watchlist, holdings table, rail (replica)
    OrderPanel/*               # ticket: tabs, product toggle, qty/price/trigger, MTF row, footer, button
    AddMoreCard/*              # the card: header, lead, rows, chain, footer, variants (IN/GTT/MTF/Reentry/US)
    ConfirmSheet.tsx
    SourceChips.tsx
  hooks/
    useLivePrice.ts            # SSE subscribe + LTP fallback polling (≥2 s) + "last traded" state
    usePosition.ts             # holdings + trades for selected instrument
data/
  cache/holdings.json, trades.json, trades-today.json   # written by scripts/fetch-upstox-cache.mjs
  instruments.json                                       # written by scripts/resolve-instruments.mjs
tests/compute.test.ts
```

## Data flow
1. Page loads → `/api/holdings` (+ `/api/instruments`) → holdings table + watchlist state.
2. Select stock → `/api/trades?isin=` → buy history / sold-out detection.
3. `/api/ltp?keys=` for the selected + holdings → initial prices; `/api/stream` SSE for ticks.
4. Card = `compute(...)` on every input change (client-side, <1 ms). No API call per keystroke.
5. US tab → `/api/us/positions`, `/api/us/fills?symbol=AAPL`, `/api/us/price?symbol=AAPL`,
   `/api/fx` (live) and `/api/fx?date=` for each fill date → US compute.
6. Review buy order → `POST /api/order` → confirm sheet (with or without order_id) → local
   position update (labelled).

## Live-or-cache rule (holdings, trades)
```
try live with UPSTOX_ACCESS_TOKEN
  200 → return {data, source:"live", fetched_at: now}; also write cache
  401/403/expired → read data/cache/*.json → {data, source:"cache", fetched_at: file.fetched_at}
                   and append a HUMAN_TODO entry "Refresh OAuth token: node scripts/upstox-login.mjs"
  no cache → {data: null, source:"unavailable"} → UI shows labelled unavailable state
```
Market data (LTP/candles/feed) always live with the Analytics token; never cached across sessions
except an in-memory last value for the market-closed display.

## Streaming
`upstoxFeed.ts`: authorize → connect → binary subscribe (`ltpc`) for all holdings keys + the selected
key → decode → update map → notify SSE subscribers. Reconnect with backoff (1s→30s). If the feed is
down for >10 s, `useLivePrice` polls `/api/ltp` every 2 s (never faster). Outside market hours expect
heartbeats only; display `Last traded <Fri> 15:30` from candle timestamp or `ltt` when available.

## Flags / env (see .env.example)
`ENABLE_SANDBOX_ORDER` (default false), `DEMO_ACCOUNT_LABEL` (text shown in the source chip, e.g.
"Real holdings (family account)"), `US_SYMBOL` (default AAPL), `FX_KEY_OVERRIDE` (only if the human
resolved the global key manually; still a real key, never a rate).

## Error states (render, never crash)
- Missing env → `/api/*` returns `{error:"missing_env", key}`; UI shows a yellow banner naming the key
  and the HUMAN_TODO entry.
- 401 → cache path; 429 → backoff + `Rate limited, retrying`; network → `Upstox unreachable, showing last value`.
- Alpaca no position → `Awaiting first fill` state on the US tab (no card).

## What is NOT allowed
Hardcoded prices/holdings/trades/FX anywhere in `src/`; env values in client code; `Math.random`;
"demo mode" switches that substitute fabricated data; silent catch blocks.
