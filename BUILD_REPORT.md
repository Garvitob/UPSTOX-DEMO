# BUILD REPORT — Add-More Check

**Status: built and running on the real Upstox Developer API and the real Alpaca paper API, with real market data.**
Every number on screen comes from an API response (or a `data/cache` file written by one, with its `fetched_at`). Every
phase went through the review gate: Playwright screenshots, then the CPO, Senior PM and CTO agents. Their verdicts and
rulings are in [PROGRESS.md](PROGRESS.md).

Two things wait on the outside world:
- **The US card on real fills.** The AAPL paper orders fill in Monday's US session, so until then the US tab shows its
  honest "Awaiting first fill" state.
- **The first Vercel deploy.** It needs your login and your OK to publish real holdings (see [DEPLOY.md](DEPLOY.md)).

## What was built
- **The Upstox Pro order flow, exactly as on pro.upstox.com** (the human's rule; their screenshots are in
  `reference/screenshots/upstox-pro-*.png`).
  - The holdings page opens with no order panel.
  - Hovering a row shows **Buy / Sell / ⋮**; watchlist rows show **B / S**.
  - Buy or Sell opens **"Exchange to Buy From"** with each exchange's live price and day change (NSE 1,656.00
    −22.00(−1.31%), BSE 1,664.80 −10.35(−0.62%)). Picking one slides in the **Place Order** panel.
  - **Required** comes from the Upstox Margin API for the exact order; **Available** comes from the Upstox Funds API.
    "Required" is only ever Upstox's answer ("—" while it loads or when the quantity / price box is invalid). On a Regular/MTF
    buy the button is decided only once both answers are in, so a tab or exchange change never flashes a clickable "Review
    buy order". On a Market order a live price tick is not a change to the order: Required follows the price at most every
    5 s and stays on screen meanwhile (proven with injected market-hours ticks).
  - This account has ₹0.00 available, so a buy shows Upstox's own "You've insufficient funds … add funds" and
    **Add funds**. GTT shows "Required ₹ 1651.90 · With MTF ₹ 521.50 · Review buy order", identical to Upstox.
  - **Sell** opens a sell ticket that places a real Upstox sandbox SELL order.
  - **The stock you press decides the ticket** (the human's request, 5 Oct): an Indian stock opens only the Upstox
    ticket; Buy / Sell on a row of the holdings **US Stocks** tab opens only the US ticket. There is no India/US switch
    in the panel and no "extension" pill; switching holdings tabs never changes an open ticket.
  - The ticket body matches the human's screenshots: two equal Quantity / Market columns with ⇄ squares under one
    purple label row ("Quantity ⌄ · Market ⌄ · + Trigger"); GTT has Side [Buy | Sell], "Place order · If price is
    below ⌄" and "₹ 1651.90 ⇄ 0.25 %" (both on the tick grid from the live price). The source chips sit in one strip
    above the footer.
  - On a BSE ticket the chip, the card footer and its tooltip say BSE, from BSE's own market status
    (GET /v2/market/status/BSE + the feed's BSE_EQ status).
  - Holdings **Invested** is Upstox's own figure, (quantity + t1) × last_price − pnl of the Holdings snapshot
    (TMCV 4,865.01, TMPV 10,752.99 — identical to pro.upstox.com).
  - Upstox's Funds service closes 00:00–05:30 IST (UDAPI100072). The ticket then says so in a chip (the opening time is
    read from Upstox's message), shows "Available: —", and does not block a buy while the balance is unknown.
- **Upstox Pro replica.**
  - Ticker with real index prices and the next F&O expiries.
  - Top bar with real holdings and positions P&L.
  - The account's own watchlist with live prices.
  - The holdings table and summary.
  - The Place Order ticket.

  The CSS is ported verbatim from the approved reference; qa-visual found 203 identical lines. Fonts load the same way.
- **Add-More Check card** in the BUY ticket (`src/lib/compute.ts`, `src/lib/copy.ts`, `src/components/AddMoreCard`).
  It is collapsed by default, and the header shows the one-number answer ("Avg ₹2,150.00 → ₹1,985.33"):
  - **Regular:** shares, average with break-even vs today's price, "A 10% move is worth", and buy history from Upstox
    Trade History. It recalculates on every keystroke.
  - **GTT:** the reference price is the trigger. The default trigger is ₹1,651.90 for PAYTM, the same value Upstox Pro computes.
  - **MTF:** a separate lot; the delivery average stays unchanged. "You pay", ₹/share and the 3.2X badge come from the
    **live Margin API**.
  - **Re-entry (a stock sold out earlier):** no sold-out symbol in this account (0 SELL rows since 2024-04-01);
    implemented + unit-tested; p5-reentry-none.png.
  - **US:** dollar average and rupee average side by side. Rupee figures use per-lot USD/INR and live USD/INR from
    the Upstox feed. US lot date = the IST calendar date of the Alpaca fill; its rate = the Upstox USD/INR daily close
    for that date (the live rate while that date is still open; the previous close, printed "(D Mon close)", when the
    date has no candle). A fill after 14:30 ET (13:30 ET in winter) falls after midnight IST and takes the next IST
    day's close.
- **Confirmation sheet + order.**
  - With `ENABLE_SANDBOX_ORDER=true`, Review places a **real order on `api-sandbox.upstox.com`** and shows its ID.
    IDs placed during the build: 261004130028974, 261004174901554, 261004181904582, 261004200443959 (SELL),
    261005004706750 (SELL), 261005005253929 and 261005010426673 (the last one unintended, from a QA script).
  - Any failure, or the flag off, shows the identical sheet without an ID: "Order placement not wired in this demo".
  - GTT and US orders are never sent.
  - After Done, the holdings row, the card's buy chain and a chip all say **"updated locally"**. Shares bought in the
    session count toward Day P&L from their order price.
- **Today's trades (CPO ruling).** The card starts from Upstox Holdings plus today's executed delivery trades
  (get-trades-for-day), so a second buy on the same day starts from the real position: "incl. 3 bought today" /
  "after 2 sold today". The holdings table stays exactly as Upstox returns it. Today's trades: implemented and
  unit-tested; the account had 0 trades on the build days, so the merge was not exercised live.
- **Live prices.** A server-side Upstox WebSocket (protobuf v3) feeds the browser over SSE. If the feed is down for more
  than 10 s, the page polls LTP v3 every 2 s. With the market closed it shows the real last trade: "Last traded Thu 15:59"
  for India, "Last traded Sat 01:29 IST" for US.
- **Data-source chips** say what each number came from for the current render:
  - live or cached, with its time;
  - market closed;
  - trade history;
  - sandbox order;
  - updated locally;
  - Alpaca paper;
  - USD/INR as of a given time.
- **States:** loading, unavailable and expired-token cache are labelled by their real cause. Fetches retry after 1, 2
  and 4 s, and a failed trade history still shows the card with "Buy history unavailable".
- **Phone layout** (< 900 px): order panel only, with a stock picker. No horizontal scroll at 390 px. Classic Windows
  scrollbars cause no overflow either (`scripts/check-overflow.mjs`).

## Proof that it is real
- **Real-data audit (gate run 2, CTO).** A headless script read every number on the page in 14 states, then the CTO called the raw
  Upstox and Alpaca APIs directly (not the app's routes) and recomputed each value: **176 of 176 match, 0 mismatches**, on both servers.
  A grep of `src/` found no data literal (prices, quantities, averages, FX); the only constants are documented rules (quantity 1 at open,
  the 0.25 % GTT default, the "/ 200" watchlist capacity). The audit also caught that PICCADIL is listed on NSE as well as BSE; it now gets
  the exchange dialog with NSE ₹588.00 / BSE ₹580.90.
- `node scripts/verify-card.mjs 3` recomputes the card from the raw Upstox JSON with code shared with nothing in `src/`.
  It prints PAYTM ₹2,150.00 → ₹1,985.33, break-even 29.8% → 19.9%, 10% move ₹994 → ₹1,490, ₹4,968 more. Every
  reviewer matched it to the rendered page and to their own hand calculation.
- `node scripts/smoke-api.mjs`: every route returns 200 with live data. This includes holdings, trade history, LTP and
  last-trade time, FX 96.30 from the feed, the MTF margin 522.7992, Alpaca AAPL $333.75 with 2 pending buys, and SSE ticks.
- `node scripts/scan-secrets.mjs` finds 0 of the 7 secret values in any client bundle, server bundle or API response.
  Tokens are read only in `src/server/*`.
- 115 unit tests (`npm test`) and a 60-second feed-watchdog integration test (`npm run test:slow`): formulas, the SPEC examples, edge cases, copy rules (no advice words), server failure
  modes and order isolation.

## Live vs cached
| Data | Normally | When unavailable |
|---|---|---|
| Holdings, trade history, positions P&L, avatar initials | Live (OAuth token) | `data/cache` snapshot or the runtime cache, labelled `cached <time>`, plus a HUMAN_TODO entry |
| Prices, ticker, watchlist, last-trade time, market status, FX | Always live (Analytics token, 1 year) | Labelled "unavailable"; a cached price is never shown |
| MTF margin | Live (OAuth) | Figures hidden; the reference's placeholder ratio is never used |
| US position, fills, price, clock | Live (Alpaca paper) | "Awaiting first fill" / "unavailable" |
| Sandbox order | Live (sandbox token) when the flag is on | Identical sheet without an order ID |
| Required (Margin API) / Available (Funds API) | Live (OAuth) | "—" with the reason on hover; Upstox's Funds service closes 00:00–05:30 IST and the ticket says so in a chip; nothing is estimated and a buy is never blocked by a failure |

## Real values seen during the build (Sun 4 Oct 2026, market closed; Fri 2 Oct was a holiday)
- **Holdings and prices:** PAYTM 6 @ ₹2,150 (LTP ₹1,656), TMCV 15 @ ₹324.33 (₹415.50), TMPV 15 @ ₹716.87 (₹279.40).
- **Trade history:** 0 trades since Apr 2024. A start of 2023-04-01 returns UDAPI1093, so the window starts 2024-04-01.
- **MTF margin per share:** PAYTM ₹522.7992 (3.2X), TMCV ₹123.20 (3.4X), VEDL ₹88.22 (2.9X).
- **FX and US:** USD/INR 96.30 from the feed, as of Fri 22:30 IST. AAPL $333.75 (IEX), with 2 seeded buy orders `accepted`.

## Kit corrections found against the live API
- The sandbox host is `https://api-sandbox.upstox.com`. The kit's `sandbox.upstox.com` does not resolve.
- Every LTP/quote endpoint rejects `GLOBAL_INDICATOR|USDINR`; only the WebSocket feed and the candles accept it.
- Trade-history pagination arrives under `metaData` (camelCase), not `meta_data`.
- One invalid key fails a whole LTP batch, so keys are validated against the instrument master first and failed batches
  are retried key by key.
- Alpaca timestamps carry nanoseconds; they are cut to milliseconds so every browser parses them.

## US card on the first real fill (Mon 5 Oct, 05:30 IST)
The $337.09 extended-hours paper buy filled in Alpaca's overnight session: 1 AAPL @ $333.47. The US card now runs on real
data — Avg $333.47 → $333.61, ₹32,113 → ₹32,127 at ₹96.3/$, returns +0.1% / +0.1%, a 10% move $33 → $67. The US-card
gate (CPO, SPM, CTO; the CTO recomputed 21 values from the raw Alpaca and Upstox APIs, all MATCH) led to one fix: a lot
bought today uses today's live USD/INR, the same rate the card prints as "today" (`lotsAtLiveRate`, tested), and
`/api/fx` falls back to Upstox's intraday minute candles when the feed's USD/INR tick is more than 5 minutes old.

## Known limitations (after the 2 PM deadline; documented rather than changed on submission day)
- **Upstox dates Monday's USD/INR session with the Sunday before it** (the CTO found 37 Sunday-dated daily candles in
  2026). After midnight IST, a lot dated 5 Oct takes the nearest earlier daily close, which Upstox labels 4 Oct, so the
  chain would print "(4 Oct close)" for Monday's own session. Until midnight the lot correctly uses the live rate.
- **When the second AAPL order fills at 7:00 PM IST**, Alpaca positions and fills refresh on separate 60-second timers.
  For up to a minute the rupee side can be computed from a fills list newer than the position (or show the labelled
  "fills cover only part" notice) until both refresh.
- **The US price is IEX's last trade** (Friday's $333.75 until the US session opens); Alpaca's own overnight mark differs
  by a few cents. Both are real; the ticket labels the time ("Last traded Sat 01:29 IST").

## Review gates (details and rulings in PROGRESS.md)
| Phase | Result |
|---|---|
| 0 Preflight | All live checks OK; kit sandbox host corrected |
| 1 Compute | 3 rounds (cto, cpo, 2 auditors): 21 findings fixed |
| 2 Data layer | cto BLOCK×5 fixed (fx errors, feed backoff, stale ticks, tests) |
| 3–5 Shell + card | qa-visual BLOCK (classic-scrollbar overflow), cto BLOCK×2 (silent trades failure, Infinity quantity) and spm BLOCK (re-capture) fixed; cpo PASS_WITH_NOTES |
| 6–9 Live, US, order, phone | qa-visual PASS; cpo BLOCK×5 (session orders labelled, day P&L, US wording/time) and spm BLOCK (phone columns) fixed; cto PASS_WITH_NOTES (notes fixed: feed watchdog, origin checks, paper-only host) |
| 12 Upstox order flow | Built on the human's request. **Run 1:** qa-visual BLOCK, cpo BLOCK×5, spm BLOCK×6 (BSE naming, Invested, quantity row, GTT body, panel head, watchlist hover) → fixed in fdadedd with the human's "pressed stock decides the ticket" change. **Run 2** (ultracode workflow): CTO real-data audit 176/176 numbers = raw APIs with BLOCK×2 (PICCADIL dual listing, account holder's name in a comment), CTO code review BLOCK×3, qa BLOCK, cpo BLOCK×4, spm BLOCK → all fixed. **Run 3:** qa-visual PASS, CTO PASS_WITH_NOTES (isolated build exit 0, 0 secrets), SPM PASS_WITH_NOTES, CPO BLOCK×3 + a market-hours follow-up → fixed and proven with test-only harnesses (fake balance, injected ticks). Details in PROGRESS.md |

## Blocked / needs the human (see HUMAN_TODO.md)
1. **Daily Upstox login** before the demo. The OAuth token expires at 3:30 AM IST.
2. **"Add funds" re-capture (p12-add-funds).** Needs the Funds service (05:30–24:00 IST) and a live token: after the
   Monday login, tell Claude Code "Upstox login done, capture p12-add-funds".
3. **US card on real fills.** The Alpaca paper orders fill in Monday's US session (pre-market from 1:30 PM IST, regular
   session from 7:00 PM IST). Then tell Claude Code "Alpaca fills landed, capture p7-us-card".
4. **Next.js 14 advisory.** Mitigated (localhost binding, no image optimizer, no middleware). Upgrading is your call.
5. **First Vercel deploy.** Needs your Vercel login and an OK to publish real holdings behind Deployment Protection (DEPLOY.md).
6. **Git history before sharing.** The account holder's real name was the example in a code comment and a test from commit a204694; it is
   removed from the code (the app only ever shows initials). Rewriting history is your call (HUMAN_TODO #7).

## How to run the demo
Follow [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md). It has a pre-demo checklist, a 13-step script with talking points,
evaluator Q&A and fallbacks. Screenshots for the write-up are in `artifacts/screenshots/`, and `artifacts/API_MAP.md`
maps every on-screen value to its endpoint, field and token.
