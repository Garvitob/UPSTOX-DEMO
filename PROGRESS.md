# PROGRESS — Add-More Check build

Legend: `[ ]` open · `[~]` in progress · `[x]` done · append `(blocked:human)` when only the human can unblock it.
Update this file before and after every task. The Stop hook reads it.

## Setup check
**2026-10-04 (Sun)** — setup mode run. READY TO BUILD: **no** (see HUMAN_TODO.md → Setup status).

- Tools: Node v24.13.1, git 2.51.2, npm 11.8.0; Playwright Chromium installed; `@playwright/mcp --help` launches; `.mcp.json` valid JSON.
- `git init` done. `.gitignore` covers `.env.local` and `data/cache/*.json` (verified with `git check-ignore`).
- `.env.local` created from `.env.example`. Empty: UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_ANALYTICS_TOKEN, UPSTOX_ACCESS_TOKEN, UPSTOX_SANDBOX_TOKEN, ALPACA_KEY_ID, ALPACA_SECRET_KEY. UPSTOX_REDIRECT_URI = template default `https://localhost:3000/callback`.
- `resolve-instruments.mjs` (public files, no token): indices Nifty 50 = `NSE_INDEX|Nifty 50`, Nifty Bank = `NSE_INDEX|Nifty Bank`, SENSEX = `BSE_INDEX|SENSEX`; FX = `GLOBAL_INDICATOR|USDINR` (name "USD INR", from complete.json.gz). Equities: none yet, because there is no holdings cache.
  - Fixed: the SENSEX match was a loose regex that picked `BSE_INDEX|SNSX60` ("BSE SENSEX SIXTY"). It is now an exact `trading_symbol === 'SENSEX'` match.
- `alpaca-seed-orders.mjs`: added a guard that exits without placing orders if any live order or position for US_SYMBOL already exists (`--force` overrides). Weekend orders stay pending, so a positions-only check would not stop a second seed.
- Not run (need human credentials): fetch-upstox-cache, Alpaca orders/positions check, alpaca seed.
- `reference/screenshots/`: no PNG yet.

Final `node scripts/check-env.mjs`:
```
Keys present:
  UPSTOX_API_KEY           — missing
  UPSTOX_API_SECRET        — missing
  UPSTOX_REDIRECT_URI      http…back (31 chars)
  UPSTOX_ANALYTICS_TOKEN   — missing
  UPSTOX_ACCESS_TOKEN      — missing
  UPSTOX_SANDBOX_TOKEN     — missing
  ALPACA_KEY_ID            — missing
  ALPACA_SECRET_KEY        — missing

Live checks:
FAIL analytics_token          missing
FAIL oauth_token              missing → run: node scripts/upstox-login.mjs
FAIL alpaca                   missing keys
FAIL sandbox_token            missing (optional — order flag stays off)
FAIL cache_holdings           missing → run: node scripts/fetch-upstox-cache.mjs
FAIL cache_trades             missing → run: node scripts/fetch-upstox-cache.mjs

Written data/env-check.json
```

## Preflight (Phase 0)
- [x] Read CLAUDE.md, docs/SPEC.md, docs/ARCHITECTURE.md, docs/API_UPSTOX.md, docs/API_ALPACA.md, docs/UI_REFERENCE.md, docs/PHASES.md — plus reference HTML (CSS + `compute()`), agents, scripts, hook; prompt read twice
- [x] `node scripts/check-env.mjs` → all 7 live checks OK (Sun 4 Oct 2026 12:57 IST), see below
- [x] `node scripts/resolve-instruments.mjs` → rewritten to use complete.json.gz once; 3 holdings (+BSE keys, tick sizes), 14 watchlist symbols, 3 indices + next expiries, FX key
- [x] Caches present → holdings PAYTM / TMCV / TMPV; trades 0 rows since 2024-04-01; trades-today 0 rows
- [x] LTP v3 sanity call recorded — 36/36 keys in one batch, HTTP 200 (values below)
- [x] Alpaca positions/orders status recorded — 0 positions, 0 fills, 2 seeded AAPL buys `accepted`

### Preflight results (real values, 2026-10-04 ~13:00 IST, market closed — Sunday; Fri 2 Oct was the Gandhi Jayanti holiday)
```
check-env: analytics_token OK (Nifty 50 LTP 22421.95) · oauth_token OK (3 holdings: PAYTM 6@2150, TMCV 15@324.33, TMPV 15@716.87)
           alpaca_account OK (ACTIVE, buying power $399,329.37) · alpaca_positions OK (0) · sandbox_token present
           cache_holdings fetched_at 2026-10-04T07:12:49Z · cache_trades fetched_at 2026-10-04T07:12:49Z
LTP v3 (Analytics): NSE_EQ:PAYTM 1656 (cp 1678) · BSE_EQ:PAYTM 1664.8 · NSE_EQ:TMCV 415.5 (cp 421.65) · NSE_EQ:TMPV 279.4 (cp 283.5)
           NSE_EQ:VEDL 252.05 · NSE_EQ:IRFC 77.06 · BSE_EQ:PICCADIL 580.9 · Nifty 50 22421.95 (cp 22620.45)
           Nifty Bank 54450.75 · SENSEX 71909.7 — identical to the human's Upstox Pro screenshot
Full quote v2: PAYTM last_trade_time 1790850575180 = Thu 1 Oct 15:59:35 IST · market status NSE = CLOSING_END
Trade history: start 2023-04-01 → UDAPI1093 · start 2024-04-01 → 200, 0 rows (pagination key is metaData.page)
Margin (OAuth): PAYTM 1 @ 1656 product MTF → required_margin 522.7992 (= Upstox Pro "Buy for ₹522.80/share with MTF")
Instruments: FX GLOBAL_INDICATOR|USDINR (LTP rejects it; candles v3 OK: 2 Oct close 96.30) · indices NIFTY 50 exp 06 Oct,
           BANKNIFTY exp 27 Oct, SENSEX exp 08 Oct (from NSE_FO/BSE_FO expiries)
Alpaca paper: positions [] · fills [] · orders: AAPL buy 1 limit $337.09 ext-hours (accepted), AAPL buy 1 market (accepted),
           both created 2026-10-04T07:16Z · latest trade (iex) $333.75 @ 2026-10-02T19:59:59Z · clock next_open 2026-10-05 09:30 ET
Sandbox: POST https://api-sandbox.upstox.com/v3/order/place → 200 order_ids ["261004130028974"]
```
Corrections made to the kit (evidence in docs/API_UPSTOX.md "Preflight corrections"):
- Sandbox host `sandbox.upstox.com` does not resolve; the real host is `api-sandbox.upstox.com` (official SDK + live 200).
  Fixed in docs/API_UPSTOX.md, .env.example and `.env.local` (`UPSTOX_SANDBOX_BASE` only).
- `data/watchlist.json` created from the 14 symbols visible in the human's own Upstox Pro screenshot (no watchlist API exists);
  prices are live. Reference screenshots copied to `reference/screenshots/upstox-pro-holdings.png` / `upstox-pro-gtt.png`.
- No sold-out symbol exists in the real trade history → the re-entry card will be implemented + unit-tested but cannot render
  with this account's data (IRFC from the reference has no real SELL row).

## Phase 1 — Scaffold + compute
- [x] Next.js 14.2.35 + React 18.3 + TS 5.9 (strict) + Tailwind 3.4 (preflight off) + vitest 5 + ws 8 + protobufjs 7 + server-only; `npm run build` green; dev/start bound to 127.0.0.1
- [x] `src/lib/compute.ts`, `format.ts`, `copy.ts`, `types.ts` — SPEC formulas + every card/receipt string; direction words decided on printed values; no NaN paths
- [x] `tests/compute.test.ts` green — 57 tests: PAYTM example, averaging up, T1, GTT ref, MTF (real margin 522.7992), US example, nth, netting, FIFO, FX wording, receipts, fact-only words
- [x] Gate: 3 review rounds — round 1 cto BLOCK×5 + cpo BLOCK×5 + 2 auditors (21 findings); round 2 cpo BLOCK×4 (edge cases), cto BLOCK×2
  (float-vs-display direction, unchecked Q) — all fixed and covered by tests (57/57); cto confirmed every round-1 fix incl. a 60,000-card sweep
  (0 NaN, 0 false "because") and a live hand check (PAYTM ₹1,985.33 · 29.8%→19.9% · ₹994→₹1,490). Committed "phase 1".

## Phase 2 — Upstox data layer
- [x] server/env.ts, upstox.ts, cache.ts, instruments.ts (+ market.ts; upstoxFeed.ts pulled forward: /api/fx needs it — the
  LTP endpoints reject GLOBAL_INDICATOR|USDINR, only the WebSocket feed streams it); 9 server tests (401→cache, 429 backoff, …)
- [x] /api/holdings (live-or-cache + source meta; + short-term positions P&L + profile initials, both live-or-cache)
- [x] /api/trades?isin= (whole 3-FY window fetched once, 5-min memo; 2023-04-01 → UDAPI1093 → 2024-04-01; metaData pagination)
- [x] /api/ltp?keys= (LTP v3; invalid-key batch retried key by key; ltt from the feed snapshot, else quotes v2; NSE market status)
- [x] /api/instruments (data/instruments.json + on-demand resolution from the public master)
- [x] /api/fx and /api/fx?date= (feed tick → intraday 1-min candle → daily close; per-date daily close, labelled fallback) + /api/margin (MTF)
- [x] scripts/smoke-api.mjs output (live, Sun 4 Oct 2026 17:37 IST, market closed):
```
200  /api/instruments              17 equities, watchlist 14, indices NIFTY 50/BANKNIFTY/SENSEX, fx GLOBAL_INDICATOR|USDINR
200  /api/holdings                 source live · PAYTM 6+0@2150, TMCV 15+0@324.33, TMPV 15+0@716.87 · positions pnl 0 · initials DA
200  /api/trades?isin=INE982J01020 source live window 2024-04-01→2026-10-04 · 0 row(s) for PAYTM
200  /api/ltp?keys=…&ltt=1         PAYTM 1656 (cp 1678, ltt 2026-10-01T10:29:35Z = Thu 15:59 IST) · TMCV 415.5 · TMPV 279.4 ·
                                   Nifty 50 22421.95 · Nifty Bank 54450.75 · SENSEX 71909.7 · market CLOSING_END
200  /api/fx                       GLOBAL_INDICATOR|USDINR rate 96.3 basis feed as_of 2026-10-02T17:00:08Z
200  /api/fx?date=2026-10-01       rate 96.305 basis daily_close date 2026-10-01
200  /api/margin?key=PAYTM&price=1656  MTF required_margin for 1 share 522.7992 (source live)
```
  Token scan (`node scripts/scan-secrets.mjs`): 0 of 7 secret values in .next-verify/static (22 files) and .next-verify/server (50 files).
- [x] Gate: cto reviewed commit 854bcad in an isolated worktree (incl. a real forced-401 run and a missing-env run). Confirmed: hosts/tokens
  correct for every call, 0 secrets in static/server bundles (also with the real env loaded at build time), every route equal to the raw
  Upstox call, 401 → labelled cache + HUMAN_TODO, missing env → `missing_env`. BLOCK×5 → all fixed in c6607cf (+ tests, 75/75):
  /api/fx now propagates the real error (missing_env/unauthorized/…), feed backoff only resets after a 30 s stable connection
  (tested 1→2→4→8→16→30 s), ticks cleared on disconnect (no stale "live" values), watchlist symbols + test, runtime-cache test isolation;
  notes also fixed: Retry-After cap 5 s, body read inside the timeout, empty-2xx guard, trades memo catch, initials never guessed,
  HUMAN_TODO wording, impossible dates → 400, Q=0 receipt guard. Feed re-check folded into the Phase 6 CTO gate.

## Phase 3 — Shell replica
- [x] Reference CSS ported verbatim (qa-visual: 203 lines identical); ticker, topbar, watchlist, holdings table, summary, rail — all on
  real data (holdings live from Upstox, LTP v3 + feed, real P&L summary 20,359.50 / 28,518.00 / −8,158.50); p3-shell.png
- [x] Source chips component (10px pills, truthful per render: price state · real holdings fetched/cached · trade history · sandbox order;
  US: Alpaca paper · USD/INR (Upstox) as of)
- [x] Gate 1 (wf_c8c1436f): qa-visual BLOCK (classic Windows scrollbars → horizontal scroll in the order body) → fixed 6eeefd7 + ac127d8
  (`node scripts/check-overflow.mjs`: 344/344 in every expanded state); spm's re-capture done in the final gate runs 2–3 (p3-shell,
  p12-start; qa-visual run 3 PASS, check-overflow every line ok)

## Phase 4 — Card (Regular tab)
- [x] AddMoreCard: header, lead, rows, chain, footer, ⓘ tooltip — PAYTM ₹2,150.00 → ₹1,985.33 · 29.8% → 19.9% below · ₹994 → ₹1,490 ·
  ₹4,968 (`scripts/verify-card.mjs` from the raw API = rendered DOM = reviewers' hand calc)
- [x] Shown only when held (ISIN match, Q = quantity + t1_quantity); never-held VEDL / IRFC → no card
- [x] Live recalculation: qty stepper (capped, finite), Market/Limit toggle, limit price; Review disabled while a limit/trigger box is empty
- [x] Screenshots p4-card-collapsed, p4-card-expanded, p4-card-avg-up (TMCV raises ₹324.33 → ₹339.53), p4-no-card
- [x] Gate 1: cpo PASS_WITH_NOTES (MTF tooltip → done ac127d8); cto BLOCK×2 — trades transport failure hid the card silently (→ labelled
  "Buy history unavailable" + retries + refetch on re-select) and a 310-digit quantity printed ₹NaN/∞ (→ input caps, finite guards,
  test) → fixed 5d781d8 with every cto note (ISIN matching, LTP validation, holdings "—"/messages, error clearing); re-checked by the CTO
  in the final gate runs 2–3 (run 3 PASS_WITH_NOTES)

## Phase 5 — GTT, MTF, re-entry
- [x] GTT tab: trigger drives ref/price (default LTP − 0.25% on the tick grid = Upstox Pro's 1651.90); 1500 → ₹1,933.33 · 43.3% → 28.9%
- [x] MTF tab variant on the real Margin API (₹522.80/share, 3.2X) — "Avg ₹2,150.00 → unchanged", MTF-only ⓘ sources
- [x] Re-entry: no sold-out symbol in this account (0 SELL rows since 2024-04-01); implemented + unit-tested; p5-reentry-none.png
- [x] Screenshots p5-gtt, p5-gtt-default, p5-mtf, p5-reentry-none — refreshed in the final gate runs 2–3 on the Upstox GTT body
  (trigger 1500 → % 9.42, card ₹2,057.14; default 1651.90 / 0.25 %); qa-visual run 3 PASS

## Phase 6 — Live price
- [x] server/upstoxFeed.ts (authorize → wss → binary sub (ltpc) → protobuf FeedResponse → LTP map; backoff 1→30 s; idle close 5 min; globalThis singleton)
- [x] /api/stream (SSE) + hooks/useLivePrice (snapshot → SSE ticks → 2 s polling only if the feed is down > 10 s; last-traded state) —
  `node scripts/sse-soak.mjs 65`: held 65.0 s, status connected, 7 ticks incl. USDINR 96.3, NSE_EQ market event, 4 heartbeats (15 s), no errors
- [x] Screenshot p6-live (chip "NSE closed · last traded Thu 15:59" = feed ltt, /api/stream open, values = LTP v3) — re-captured with the
  Upstox flow and the chip strip above the footer in gate run 3 (qa-visual PASS). Market-hours behaviour proven with a test-only tick
  injection after run 3: ticks never disable the button or blank Required (60d1ba1)

## Phase 7 — US tab
- [x] /api/us/positions, /api/us/fills, /api/us/price (Alpaca paper, GET-only; IEX snapshot + clock); polling only while the US tab is open
- [x] US card per SPEC (FIFO-held lots, per-lot FX from /api/fx?date= on the fill's IST date), India/US switch, US holdings view — unit-tested
  on the SPEC example; renders as soon as Alpaca reports a fill
- [x] Awaiting-first-fill state — p7-us-awaiting.png (AAPL $333.75 IEX, ≈ ₹32,140 at ₹96.30/$, "Last traded Fri 15:59 ET", opens-at note)
- [x] Screenshot p7-us-card — the AAPL extended-hours limit buy filled in Alpaca's overnight session (1 @ $333.47, 2026-10-05 00:00:12Z =
  05:30 IST); US card on real data: Avg $333.47 → $333.61, ₹32,113 → ₹32,127 at ₹96.3/$ (lot at the live rate until 5 Oct closes), returns
  +0.1% / +0.1%, 10% move $33 → $67; recomputed by hand from the raw fill, IEX price and Upstox USD/INR (re-captured after the morning login)

## Phase 8 — Order flow
- [x] Confirm sheet (receipt copy per SPEC + CPO rulings) + local position update (labelled "updated locally", columns do not reflow)
- [x] /api/order with ENABLE_SANDBOX_ORDER → api-sandbox.upstox.com (sandbox token, isSandboxHost guard, GTT never sent, US never placed);
  real sandbox orders 261004174901554 and 261004181904582; flag off (:3002) → identical sheet without an id
- [x] Screenshots p8-confirm (real sandbox BUY 261005005253929, captured while Upstox's Funds service was closed, so the balance was
  unknown and the buy not blocked), p8-local-update, p8-confirm-flag-off, p8-local-update-flag-off, p8-confirm-gtt, p8-confirm-us — the
  flag-off, GTT and US sheets re-captured on :3002 after gate run 3; the SELL receipt is p12-sell-confirm (sandbox 261005004706750)

## Phase 9 — Polish + phone + docs
- [x] Loading / error / unavailable / market-closed states (labelled by cause; fetch retries 1/2/4 s; US "Last traded … ET")
- [x] Phone layout (<900px) with stock selector ("PAYTM — held, at a loss"); no horizontal scroll; ticket columns 243/107 as the reference
- [x] README.md (run, env, what is real), artifacts/API_MAP.md, docs/DEMO_RUNBOOK.md
- [x] Final screenshot set complete · `npm run build` + `npm test` green · Gate PASS · commit
  - build: isolated `next build` of a8c71db by the CTO (git archive copy, real env loaded at build time) → exit 0 with type check;
    `scan-secrets` → 0 of 7 secrets in 82 files (static + server) and 0 in 118 (all of .next); the account holder's name in 0 files ·
    `npm test` 110/110 at 60d1ba1 · `npm run test:slow` 1/1 · `npx tsc --noEmit` clean

## Phase 12 — Upstox order flow (the human's request, 2026-10-04 19:41: "work exactly like Upstox", real data only)
- [x] Holdings rows: hover → Buy / Sell / ⋮ (Upstox Pro); watchlist rows: hover → B / S — reference/screenshots/upstox-pro-row-buy-sell-hover.png
- [x] "Exchange to Buy From" / "Exchange to Sell From" dialog with each exchange's live LTP v3 / feed quote and change
  (PAYTM NSE 1,656.00 −22.00(−1.31%), BSE 1,664.80 −10.35(−0.62%) — identical to the human's pro.upstox.com screenshot);
  a stock listed on one exchange only opens the ticket directly (corrected in gate run 2: PICCADIL is also listed on NSE —
  NSE_EQ|INE546C01010 ₹588.00 — so it now gets the dialog like every other dual-listed stock; no single-exchange stock is in this account's list)
- [x] Place Order panel slides in after the pick (closed at load; ✕ closes; cart reopens); exchange-aware ticket (BSE radio
  switches the LTP, Margin API key and order key); quantity 1 like Upstox
- [x] Footer from real APIs: Required = POST /v2/charges/margin for the exact order (BUY D 1 @ 1656 → 1656.00, SELL → 0.00,
  MTF → 522.80); Available = GET /v2/user/get-funds-and-margin (₹0.00 on this account) → "You've insufficient funds to buy
  PAYTM. To continue, add funds." + Add funds, as in the human's screenshot; GTT → "Required ₹ 1651.90 · With MTF ₹ 521.50"
  + Review buy order (= the human's GTT screenshot)
- [x] Sell ticket (Regular/GTT, no MTF, no card, red Review sell order) → sandbox SELL order on the picked exchange → sell receipt
- [x] Gate run 1 (wf_a88c8465, 4 Oct 20:37): qa-visual BLOCK, cpo BLOCK×5, spm BLOCK×6, cto did not finish (session limit) → fixed in fdadedd:
  exchange-aware chip / card footer / tooltips / buy receipt from each exchange's own market status (GET /v2/market/status/{NSE,BSE} + feed
  BSE_EQ events); Invested = (qty + t1) × last_price − pnl of the Holdings snapshot (4,865.01 / 10,752.99 = Upstox); Upstox quantity/price row
  (two equal columns with ⇄ squares, purple "Quantity ⌄ · Market ⌄ · + Trigger", typing a price → Limit, funds error under the inputs); GTT
  Side [Buy|Sell] + "Place order · If price is below ⌄" + ₹ trigger ⇄ % (tick grid) + T&C; chips in one strip above the footer; watchlist
  B/S hide the price block; Add-funds copy without the HTTP path; stale p8 shots → artifacts/screenshots/superseded/; 106 tests
- [x] **Human's request (5 Oct 00:30 IST):** the Place Order panel opens for the market of the stock that was pressed — an Indian stock
  (holdings / watchlist → NSE/BSE) opens only the Upstox ticket, a row of the US Stocks holdings tab (Buy / Sell) opens only the US ticket;
  no India/US toggle in the panel; no "extension" pill on the US Stocks tab; switching holdings tabs never flips an open ticket; every value
  from the real APIs. "Otherwise the UI is perfect."
- [x] Upstox's Funds service is closed 00:00–05:30 IST (real UDAPI100072): chip "Upstox funds service closed · opens 5:30 AM IST" (time read
  from Upstox's message), Available "—", and a BUY is not blocked while the balance is unknown
- [x] Re-capture p12-add-funds — after the human's login (11:54 IST, market open): Funds API ₹0.00, Margin API Required ₹1,675.60 at
  the live price → "You've insufficient funds to buy PAYTM. To continue, add funds." + Add funds (= the human's screenshot); chip
  "Live NSE price"; 20 s of REAL ticks: 5 price changes, 552 frames, 0 with a disabled button or "Required: —"; US card live with
  USD/INR ₹96.27 ("Live USD/INR"), lot at today's live rate. Re-captured p12-panel-open, p6-live, p12-add-funds, p7-us-card, p12-us-tab
- [x] Gate run 2 (ultracode workflow wf_cf6ac5e1, 5 Oct 00:42–01:25 IST) on fdadedd — all fixed:
  - **CTO real-data audit BLOCK×2:** 176/176 on-screen numbers recomputed from the RAW Upstox/Alpaca APIs = MATCH, 0 hardcoded data literals.
    (1) PICCADIL is also listed on NSE (NSE_EQ|INE546C01010 ₹588.00) but was resolved BSE-only → resolver + on-demand resolution fixed,
    it now gets the NSE/BSE dialog; (2) the account holder's real name was the example in a doc comment + test (reached the dev bundle)
    → neutral example (d7dbe21; git history = HUMAN_TODO #7). Notes fixed: Required only from the Margin API ("—" while pending, CTA held),
    neutral "<EX> price" chip when status is unknown, same-day US lot "(live, day not closed)" + 10-min refetch.
  - **CTO code review BLOCK×3** (isolated build of fdadedd exit 0, 0/7 secrets in 82 files, forced-401 run OK): GTT condition kept as state,
    BSE tick from the BSE listing, first-load pick never touches an open US ticket (0a3b7b2). Notes fixed: Review needs a real quantity,
    funds fetched/labelled only where used, US sell Required "—", GTT Side stays inside GTT, tsconfig leftovers.
  - **qa-visual BLOCK** (31 screenshots; console clean): hover Buy/Sell/⋮ covered the Current column with the ticket open → Upstox-size
    buttons inside the Invested cell (0a3b7b2; measured clear at 1920×1030 and 1366×768).
  - **CPO BLOCK×4:** the quantity regex I broke in 0a3b7b2 (Review disabled on every Indian ticket — caught before any capture; fixed),
    stale p12-add-funds / p12-single-exchange → superseded/, hover (above), no Market depth on GTT. Confirmed: the human's request, the
    funds-closed copy/behaviour, GTT rows + T&C, departures 11–15, US sell, every gate-run-1 BLOCK. **SPM BLOCK×1:** re-capture the hover.
  - Sandbox orders in run 2 (no money): SELL TMCV/BSE 261005004706750, BUY PAYTM/NSE 261005005253929, and one unintended BUY
    261005010426673 from qa-visual's own text-scan script.
- [x] Gate run 3 (wf_5f760be8, re-check at a8c71db): **qa-visual PASS** (hover clear at every width, PICCADIL dialog = raw LTP,
  GTT above + 0.5 → 1664.30, BSE trigger 1660.65, qty 2 → Required ₹3312.00 = Margin API, FX chip one line, no overflow);
  **CTO PASS_WITH_NOTES** (every gate-run-2 BLOCK verified against the raw APIs; isolated build exit 0; 0/7 secrets; name in 0 files);
  **SPM PASS_WITH_NOTES**; **CPO BLOCK×3** → fixed in f925244 (Review clickable only once Upstox's Required and Available answers are
  in, last state held and disabled while pending; same-day FX "(live rate until the day closes)"; US qty ≥ 0.1) and proven with a
  test-only ₹1,000 balance. **CPO follow-up BLOCK** (market hours: ticks re-pended the Margin answer on a Market order) → fixed in
  60d1ba1 and proven with test-only tick injection; **CPO PASS_WITH_NOTES** at 60d1ba1. Its last note (pure, unit-tested sampling and
  matching rule) done: marketSampleStep / marginAnswerFor in compute.ts + 4 tests (114 tests); both harnesses re-run, unchanged.
  Notes left by design: GTT stays ungated (CPO ruling); Required may lag a moving price by ≤ 5 s on a Market order (CPO ruling);
  colour / glyph / row-height polish (the human: "otherwise the UI is perfect").

## Phase 10 — Close out
- [x] BUILD_REPORT.md written (built / live vs cached / blocked / how to demo) — final at close-out (5 Oct 02:41 IST, de9bc2a)
- [x] `.build-complete` created

## Phase 11 — Vercel deploy path (added at the human's request in chat, 2026-10-04)
- [x] Serverless-safe server: runtime cache writes go to the OS temp dir (never the project/read-only FS); `data/` + proto traced into functions (`outputFileTracingIncludes`); SSE route `maxDuration = 300`, closes at 280 s, `retry: 2000`, client polls LTP every 2 s if the feed is down > 10 s; `vercel.json` pins functions to bom1 (Mumbai)
- [x] `DEPLOY.md` + `scripts/vercel-env-push.mjs` (pushes only runtime keys, never prints values) + `.vercelignore` (personal screenshots, artifacts, .claude) + daily token refresh steps
- [x] Production build verified locally — `NEXT_DIST_DIR=.next-prod npm run build` then `next start` on :3003: all 12 /api routes 200 with live data
  (holdings live, LTP + ltt, FX 96.3 via feed, MTF margin 522.7992, Alpaca AAPL $333.75 + 2 pending buys, SSE connected with ticks);
  `node scripts/scan-secrets.mjs .next-prod/static .next-prod/server` → 0 of 7 secrets in 79 files
- [x] Public GitHub copy at the human's request (2026-10-05 12:55 IST): github.com/Garvitob/UPSTOX-DEMO (public), one commit `faeb2e7`
  made with `git archive` from master `f566cf8`. It has no history, because old commits carry the account holder's name. It leaves out
  `reference/screenshots/*.png` and `artifacts/screenshots/superseded/`. 183 files: 0 of 7 secrets, and 0 of 8 account identifiers
  (live Upstox profile + Alpaca account). A fresh clone builds the way Vercel does (exit 0, no `.env.local`), and all 12 routes trace
  `data/*.json` and the feed proto. DEPLOY.md gained "From GitHub" steps. Later changes are copied into C:\upstox-share and pushed
  from there, never from this repo.
- [ ] First deploy to Vercel (blocked:human) — needs the human's Vercel login and an explicit OK to publish real holdings to a URL (HUMAN_TODO #4; steps in DEPLOY.md, from GitHub or the CLI)

---
## Decisions & rulings (CPO = product/copy authority, CTO = technical authority)
Phase 1 gate (2026-10-04, 1st review: cto BLOCK ×5, cpo BLOCK ×5, 2 independent auditors, 21 findings → all fixed):
- **CPO Q1** MTF lead → "MTF buys are funded separately and **leave your delivery average unchanged**." ("don't" is a banned word, rule 4).
- **CPO** MTF header → "Avg ₹2,150.00 → **unchanged**" (the reference's blended "→ ₹1,985.33" contradicted the MTF lead); blended cost stays in "All PAYTM shares".
- **CPO Q2** US FX copy: "because" only when the dollar and rupee averages move apart (the SPEC case, where FX provably is the cause);
  otherwise "with $1 at ₹A today vs ₹B when you bought" / "…, the same as when you bought"; rates print at 2 decimals when they tie at 1;
  the "Why they differ" line is hidden when the two returns print the same or the FX move prints 0.0%; a 0.0% return tile is uncoloured.
- **CPO Q3** keep "keeps your average at"; "(was 27.8% below)" side only when the break-even visibly crosses the reference; direction words from printed values.
- **CPO Q4** title "Order placed · PAYTM" stays even when nothing was sent (SPEC: identical sheet; the meta line discloses it); sub drops "· Sandbox" without an order id;
  MTF receipt "Delivery average ₹2,150.00 · unchanged / MTF lot … / ₹14,904 in PAYTM (9 sh …)"; the reference's unverifiable "broker API Upstox US runs on" claim is dropped.
- **CPO** GTT receipt states only what happens if it fires ("If it fires: avg ₹2,150.00 → ₹1,933.33" / "₹13,500 in PAYTM if it fires (9 sh at ₹1,500.00)" /
  "Your break-even would be ₹1,933.33"), meta "Order placement not wired in this demo.", no local update, never sent to the sandbox.
- **CPO** same-day trades net off (Indian settlement): one net buy/sell per trade_date; an intraday round trip leaves the chain unchanged.
- **CPO Q6** show the real last-trade time ("Last traded Thu 15:59") — SPEC's "Fri 15:30" was an example and Fri 2 Oct was a holiday.
- **CPO Q7** watchlist = the human's list first (matches the screenshot), holdings appended; count = rows rendered; phone labels from real pnl sign; "not held (no card)".
- **CPO Q8** US "Review buy order" never places an Alpaca order (rule 6 limits placement to the Upstox sandbox; a demo click would change the paper position the card reads).
- **CPO Q9** nothing replaces the reference's hardcoded "LRS this FY" (no API source). **Q10** footers carry the full SPEC strings incl. "Not a recommendation.".
- **CTO** Q = quantity + t1_quantity in code (`heldQty`); US rupee side → labelled "unavailable" (never NaN) unless FIFO-held lots cover the position;
  dev/start bound to 127.0.0.1 and image optimizer off (Next 14.2.35 advisories; Next 14 is a kit pin); US lots split per order + IST day.

Phases 3–5 gate (2026-10-04 18:29):
- **CPO PASS_WITH_NOTES** — scope/copy/figures confirmed; an emptied Limit/Trigger box keeps the reference's fallback price on the card
  (accepted as-is; Review is now disabled while the box is empty or invalid, so nothing is sent at a price the box does not show);
  MTF ⓘ lists only its real sources (Holdings, Margin API MTF, live price); re-entry = "none in this account" (implemented + unit-tested).
- **CTO** trades transport failure → card still renders with the SPEC "Buy history unavailable" line; quantity capped (7 digits India,
  8 chars US) and non-finite quantities render no card; held status matched on ISIN; quotes without a finite price > 0 are dropped.
Phases 6–9 qa-visual notes (2026-10-04 18:40), fixed in 5d781d8: the "updated locally" tag sits on its own zero-width line (holdings
columns do not reflow); phone ticket columns 243/107 as the reference; holdings errors named by cause; US polling only on the US tab.
Phases 6–9 gate — **CPO rulings** (2026-10-04 18:50), fixed in 86e16ed:
- Orders of this session are always labelled "updated locally" — a chip after the holdings chip ("PAYTM updated locally", amber) and
  " (updated locally)" after their date in the chain — and never count as Trade History. Same for US lots (`order_id: 'local'`).
- Shares bought in this session add (LTP − order price) × qty to Day P&L and stay out of the previous-close base (row −132.00,
  summary −285.75 (−1.38%) after buying 3 PAYTM at ₹1,656.00; Day % stays −1.31%).
- US receipt with no Alpaca position: "If it fills: new position 1 sh @ $333.75 · $333.75 in AAPL" (same form as the GTT "If it fires").
- Every time on the US tab reads in IST: "Last traded Sat 01:29 IST" under the price while the US market is closed, the FX chip
  "USD/INR (Upstox) · as of Fri 22:30 IST", and "US market opens Mon 7:00 PM IST".

**Human's START RULE** (2026-10-04 19:41, top priority): the UI and the click flow work exactly like Upstox Pro (hover →
Buy/Sell → NSE/BSE → panel), and every value anywhere on the page comes from the real Upstox / Alpaca APIs — nothing
hardcoded. Where the kit's reference HTML differs (always-open panel, quantity 3, "With MTF" footer on Regular), the
human's pro.upstox.com screenshots win. Funds: this account has ₹0.00 available, so a BUY on Regular/MTF shows "Add
funds" exactly as Upstox does; the Add-More card still renders in full; SELL and GTT tickets reach the confirmation sheet.

Open-question rulings — **CPO** (2026-10-04 19:19):
- **Q1 today's trades:** the card's starting position = Upstox Holdings + today's executed DELIVERY trades
  (GET /v2/order/trades/get-trades-for-day, product D), netted per day like the history. Net buy n at the day's weighted
  buy price p̄ → Q = Qh + n, A = (Qh·A + n·p̄)/(Qh + n), a chain lot dated today, subline "incl. 3 bought today" (with T1:
  "incl. 2 settling, 3 bought today"). Net sell s → Q = Qh − min(s, cnc_used_quantity), A unchanged, subline "after 2 sold
  today" (with T1: "incl. 2 settling · after 2 sold today"); Q = 0 → re-entry card. Intraday/MTF trades never change Q or A.
  Merge only when the trades and the Holdings snapshot were fetched on the same IST day; dedupe against Trade History by
  trade_id; trades unavailable → card from Holdings with "excl. today's trades (unavailable)". The holdings TABLE stays
  exactly as Upstox Holdings returns it. Implemented + unit-tested (10 tests); the account had 0 trades on the build days.
- **Q2 FX chip:** "Live USD/INR (Upstox GLOBAL_INDICATOR|USDINR)" / "USD/INR (Upstox GLOBAL_INDICATOR|USDINR) · as of Fri
  22:30 IST" / "USD/INR (Upstox GLOBAL_INDICATOR|USDINR) · 2 Oct close"; the key comes from the /api/fx response; tooltip
  "Upstox GLOBAL_INDICATOR|USDINR via Market Data Feed V3 · Fri 2 Oct 22:30 IST".
- **Q3 per-lot FX date:** keep the IST calendar date of the Alpaca fill (documented in BUILD_REPORT.md and API_MAP.md).

**Deliberate departures from SPEC / the reference (approved — reviewers must not revert them):**
1. MTF lead "leave your delivery average unchanged" (SPEC's "don't change…" uses a banned word) and MTF header "Avg ₹X → **unchanged**".
2. "keeps your average at" / "keeps your dollar average at" when the printed averages are equal; "Break-even · at today's price" when a gap prints 0.0%.
3. GTT, MTF and US receipt lines and meta texts as ruled above (no claims about orders that were not sent or have not fired).
4. US FX wording variants (only the SPEC case says "because"; rates at 2 decimals when they tie; "the same as when you bought").
5. "≈ ₹3,717" in the US 10% row — SPEC's ₹3,718 is a rounding typo (0.1 × 2.4 × 176 × 88 = 3,717.12; the reference JS prints ₹3,717 too).
6. "Last traded Thu 15:59" — the real last-trade time (SPEC's "Fri 15:30" was an example; Fri 2 Oct 2026 was a holiday).
7. No "LRS this FY" in the US footer (hardcoded in the reference, no API source); no Alpaca order placement (CPO Q8).
8. India share counts print ungrouped like the reference; the watchlist header count is the number of rows rendered.
9. SPEC line 23 (Q = quantity + t1_quantity) → Holdings + today's executed delivery trades, per docs/API_UPSTOX.md:73
   ("include today's buys in Q") and CPO ruling Q1 above.
10. The Upstox Pro order flow (human's START RULE): no panel at load, Buy/Sell → exchange dialog → panel; quantity 1;
    Required from the Margin API, Available from the Funds API, "Add funds" when short; a Sell ticket without the card.
11. The price chip, the card footer and both ⓘ tooltips name the exchange the ticket trades on ("BSE closed · last traded Thu 15:56",
    "…the live BSE price…") from that exchange's own market status — SPEC wrote NSE when only NSE existed (CPO, final gate).
12. The buy receipt sub names the exchange like the sell sheet: "Buy 1 sh at ₹1,500.00 · NSE · Delivery · fires at trigger" (CPO, final gate).
13. Holdings "Invested" = (quantity + t1) × last_price − pnl of the same Holdings snapshot — Upstox's own figure (4,865.01, not qty × the
    rounded average 4,864.95); Overall P&L stays qty × (LTP − avg) as Upstox prints it (CPO + spm, final gate).
14. No India/US toggle in the ticket and no "extension" pill: the pressed stock decides which ticket opens (human, 5 Oct).
15. GTT body per Upstox: Side [Buy|Sell], "Place order · If price is below/above ⌄", ₹ trigger ⇄ % (tick grid), T&C line; no Market
    depth row (Upstox's GTT has none). Left out: "active till <date>" (the date would come from the clock plus a hardcoded 1-year rule,
    not an API) and stop loss / target / MPP (they change the order and nothing sends them) — CPO ruling.

---
## Status summary (keep current)
Done (5 Oct 02:41 IST): every phase built on real data (Upstox holdings, LTP v3 + feed, trade history, Margin API, Funds API, market status
per exchange, USD/INR; Alpaca paper; real Upstox sandbox orders) and gated — final gate runs 1–3 + the CPO's market-hours follow-up; the
CTO's real-data audit recomputed 176/176 on-screen numbers from the raw APIs (0 mismatches, 0 hardcoded data). 110 tests + 1 slow test.
Left for the agent: nothing.
US card: done on the first real fill (05:30 IST). Blocked on the human (HUMAN_TODO.md): p12-add-funds (fresh login, Funds
service from 05:30 IST) · first Vercel deploy · Next.js 14 advisory decision · git-history decision (account holder's name, #7)

## Build log (append, dated)
- **2026-10-04 13:10 IST — Phase 0 gate.** All live checks OK. Real holdings PAYTM 6@2150 / TMCV 15@324.33 / TMPV 15@716.87,
  0 trades since 2024-04-01 (2023-04-01 → UDAPI1093). Found and fixed a wrong sandbox host in the kit (api-sandbox.upstox.com).
  USD/INR global key works only via candles (LTP rejects it). MTF margin is available live from /v2/charges/margin.
  Alpaca: 2 seeded AAPL orders accepted, fills due Monday US sessions.
- **2026-10-04 17:37 IST — Phase 1 gate.** Compute engine + copy + 57 tests; 3 review rounds (cto/cpo + 2 auditors) all fixed. Commit a204694.
- **2026-10-04 18:01 IST — Phase 2 gate.** All routes equal the raw Upstox calls; 0 secrets in bundles; cto BLOCK×5 fixed (c6607cf, 75 tests).
- **2026-10-04 18:29 IST — Phases 3–5 gate 1.** qa-visual BLOCK (classic-scrollbar overflow) fixed in 6eeefd7/ac127d8; cpo PASS_WITH_NOTES;
  spm BLOCK (re-capture) and cto BLOCK×2 (silent trades failure, Infinity quantity) fixed in 5d781d8 (76 tests). Re-gate pending.
- **2026-10-04 18:40 IST — Phases 6–9 qa-visual PASS.** Live chip, US awaiting state, real sandbox order 261004181904582, flag-off sheet,
  GTT sheet, local update, phone 390×844 without horizontal scroll; its 5 notes fixed in 5d781d8.
- **2026-10-04 19:03 IST — Phases 6–9 gate.** cpo BLOCK×5 (session orders unlabelled in chain/chips, day P&L for session buys, US receipt
  wording, US times) → fixed 86e16ed; spm BLOCK (phone ticket columns) → fixed 5d781d8 (243/107 measured); cto PASS_WITH_NOTES (0 BLOCKs;
  real account 0 orders/0 trades today; SSE 65 s; feed harness; missing-env and forced-401 runs; 0 secrets) — its notes fixed in ef8b613:
  feed liveness watchdog (Upstox pings every ~5 s and answers our pings in ~0.1 s, probed live) with a 62 s integration test
  (`npm run test:slow`), real backoff wiring, labelled per-date FX failures, same-origin JSON order posts, paper-only Alpaca host, feed key
  caps, banners by cause, FX chip shows GLOBAL_INDICATOR|USDINR. 83 unit tests + 1 slow test.
- **2026-10-04 20:37 IST — Final gate run 1 (wf_a88c8465)** on the Upstox flow: qa-visual BLOCK, cpo BLOCK×5, spm BLOCK×6 (BSE naming,
  Invested, quantity row, GTT body, panel head, watchlist hover, stale evidence); the CTO hit a session limit before reporting.
- **2026-10-05 00:30 IST — Human's request:** the pressed stock decides the ticket (no India/US toggle, no "extension" pill, US rows
  Buy/Sell). Built with every run-1 fix in fdadedd.
- **2026-10-05 01:25 IST — Final gate run 2 (wf_cf6ac5e1, ultracode):** CTO real-data audit 176/176 MATCH vs the raw APIs with BLOCK×2
  (PICCADIL dual listing, account holder's name in a comment/test), CTO code review BLOCK×3 (GTT condition state, BSE tick, first-load
  race), qa-visual BLOCK (hover over Current), CPO BLOCK×4, SPM BLOCK×1 → fixed in d7dbe21, 0a3b7b2, a8c71db (109 tests).
- **2026-10-05 02:21 IST — Final gate run 3 (wf_5f760be8):** qa-visual PASS, CTO PASS_WITH_NOTES (isolated build of a8c71db exit 0,
  0 secrets, name in 0 files), SPM PASS_WITH_NOTES, CPO BLOCK×3 (CTA flash on ticket changes, same-day FX label, US qty ≥ 0.1) → fixed in
  f925244 and proven with a test-only ₹1,000 balance (8 transitions sampled every 25 ms, no enabled Review before Upstox answered).
- **2026-10-05 02:34 IST — CPO follow-up BLOCK (market hours):** LTP ticks re-pended the Margin answer on a Market order → sampled price
  (≤ 1 call / 5 s), answer matched on instrument + quantity + side + product (60d1ba1); proven with a test-only tick injection (20 ticks
  200 ms apart × 3 scenarios: 0 frames with a disabled button or "Required: —"). 110 tests.
- **2026-10-05 02:41 IST — Close-out.** CPO PASS_WITH_NOTES on the market-hours fix; sampling rule made pure + unit-tested (114 tests);
  smoke-api: every route 200 live (stream now carries NSE_EQ + BSE_EQ market events); check-overflow every line ok; holdings cache
  refreshed (fetched 02:34 IST) as the fallback for after the 03:30 token expiry. BUILD_REPORT.md final; .build-complete created.
- **2026-10-05 03:45 IST — Submission pack (deadline 14:00 IST).** SUBMISSION.md (one-page cover note, CPO-reviewed twice, all
  fixes applied), scripts/demo-autopilot.mjs (18/18 steps on real data, POST /api/order blocked unless --sell-order), docs/VIDEO_SCRIPT.md and
  docs/MONDAY_CHECKLIST.md kept local as personal run-sheets (out of the export). Share audit: no secret ever committed; send a fresh
  single-commit copy without reference/screenshots/*.png (browser tabs) and artifacts/screenshots/superseded/. Alpaca: the $337.09
  extended-hours limit can fill from the overnight session (05:30 IST); docs corrected.
