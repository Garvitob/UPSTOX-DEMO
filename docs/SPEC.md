# SPEC — Add-More Check

## One line
Inside the Upstox Pro BUY ticket, when the user already holds the stock, show what this order
does to their position: shares, average, break-even, money at stake, buy history. Facts only.
Recalculates live as quantity/price/trigger change. Extension: the same card for US stocks with
the dollar average and the rupee average side by side.

## Where it appears (and where it doesn't)
| Context | Card? | Notes |
|---|---|---|
| Regular tab, stock held (CNC qty + T1 qty > 0) | Yes | Core |
| GTT tab, stock held | Yes | Trigger price is the buy price |
| MTF tab, stock held | Yes (MTF variant) | Separate-lot copy |
| Any tab, stock NOT held but sold out earlier (within trade-history window) | Re-entry card (amber) | One sentence |
| Any tab, stock never held/sold | **No card** | Ticket is identical to today's Upstox |
| US tab, AAPL (Alpaca paper) held | Yes (US variant) | $ and ₹ |

Placement: directly under the "Buy for ₹X/share with MTF" row, above "Market depth". Same
border/radius as that MTF row. Collapsed by default = header row only; click toggles.

## Inputs (all from APIs)
- `Q` held quantity = `quantity + t1_quantity` (Upstox Holdings)
- `A` held average = `average_price` (Upstox Holdings; FIFO, Upstox's number is the truth)
- `L` live price = LTP v3 `last_price` (then WebSocket ticks)
- `q` order quantity (ticket input, integer ≥ 1; US: fractional ≥ 0.1)
- `p` order price: Market → `L`; Limit → typed limit; GTT → typed trigger
- buys = BUY rows for this ISIN from Trade History (last 3 FYs), oldest first, after the last
  date the position went to zero (if any)
- sold-out = last SELL rows for an ISIN whose net position is now 0

## Formulas (pure functions, unit-tested)
```
newAvg      = (Q*A + q*p) / (Q + q)
ref         = (tab == GTT) ? trigger : L
gapBefore   = A / ref - 1          // + => avg above ref ("above today's price")
gapAfter    = newAvg / ref - 1
moveBefore  = 0.10 * Q * ref       // "A 10% move is worth" now
moveAfter   = 0.10 * (Q + q) * ref
orderValue  = q * p
nth         = buys.length + 1
```
US (Alpaca `avg_entry_price`, `qty`; FX from Upstox USD INR):
```
inrAvg      = Σ(buy.qty * buy.price * fxOnBuyDate) / Σ(buy.qty)     // per-lot FX
fxAvg       = inrAvg / A
newUsd      = (Q*A + q*p) / (Q + q)
newInr      = (Q*inrAvg + q*p*fxNow) / (Q + q)
rUsd        = p / A - 1
rInr        = p * fxNow / inrAvg - 1
fxMove      = fxNow / fxAvg - 1
```
Rounding: ₹ with 2 decimals in rows, 0 decimals in the lead sentence and chain; % to 1 decimal;
$ 2 decimals; Indian digit grouping for ₹ (`en-IN`), US grouping for $.

## Card copy — India, Regular tab (exact)
Header row: `After this order` · right: `Avg ₹2,150.00 → **₹1,985.33**` · chevron.

Lead sentence (one line, wraps):
`Buying **3 more at ₹1,656.00** lowers your average to **₹1,985.33** and puts **₹4,968** more into PAYTM.`
- If newAvg > A use `raises your average to`.

Rows (label left, `before → **after**` right, optional small line under, right-aligned):
1. `Shares` · `6 → **9**`
2. `Average price` · `₹2,150.00 → **₹1,985.33**`
   small: `Break-even · 19.9% above today's price (was 29.8%)`
   - gap > 0: `X% above today's price`; gap < 0: `X% below today's price`
3. `A 10% move is worth` · `₹994 → **₹1,490**`
   small: `How much your money changes each time the price rises or falls 10% — up from ₹994 because you'll hold more shares`
   (if q lowers it — impossible for a buy — never shown)
4. Chain line: `Buys so far: **₹2,460** → **₹2,200** → **₹1,790** → **₹1,656** this order · 4th buy`
   small line: `12 Jan 2026 · 3 Mar 2026 · 9 Jun 2026 · since Apr 2023`
   ("since <first month of the 3-FY window>" = start_date used in the trade-history call)

Footer: `ⓘ Based on your holdings and the live NSE price. Charges excluded. Not a recommendation.`
ⓘ title/tooltip: `Sources: Upstox Holdings API, Trade history API (last 3 FYs), live NSE price via market data feed. Charges excluded.`

## GTT tab
Header: `If this GTT fires`. Lead: `If this GTT fires, buying **3 at ₹1,500.00** lowers your average to **₹1,933.33** and puts **₹4,500** more into PAYTM.` Rows identical, with `ref = trigger` and the small line reading `… above the trigger` / `… below the trigger`.

## MTF tab
Header: `After this MTF order`. Lead: `MTF buys are funded separately and **don't change your delivery average**. This order creates an MTF lot of **3 shares at ₹1,656.00** — you pay ₹1,568, Upstox funds the rest.` ("you pay" = `Required with MTF` figure from the ticket; if not computable, omit the dash clause.)
Rows: `Delivery shares` · `6 @ ₹2,150 → **unchanged**`; `MTF lot` · `— → **3 @ ₹1,656**` small `interest applies daily`; `All PAYTM shares` · `6 → **9**` small `blended cost ₹1,985.33`.

## Re-entry card (amber icon, same card shell)
Header: `You've owned IRFC before` · right: `Sold at ₹142.20 · now **₹65.14 lower**`.
Lead: `You sold **50 shares at ₹142.20** on 14 Mar 2026. Today's price **₹77.06** is **₹65.14 lower** (−45.8%). This order starts a fresh position of 1 share — there is no old average to blend with.`
Footer: `ⓘ From your trade history (last 3 financial years). Not a recommendation.`

## US card (Alpaca paper + Upstox USD INR)
Header: `After this order` · right: `Avg $182.10 → **$180.31**`.
Lead: `Buying **1 more at $176.00** brings your dollar average down to **$180.31** — but your rupee average goes **up** to **₹15,223**, because $1 costs ₹88.0 today vs ₹83.0 when you bought.`
Two-stat row: `Your return today, in dollars` **−3.3%** | `Your return today, in rupees` **+2.5%** (neg red / pos green — this is the only coloured element, it mirrors Upstox P&L colouring).
Why line: `Why they differ: the rupee weakened 6.0% since your buys (₹83.0 → ₹88.0 per $), which adds to your rupee return.` (strengthened / takes from, when fxMove < 0)
Rows: `Shares` · `2.4 → **3.4**`; `Average price in $` · `$182.10 → **$180.31**` small `Break-even · 2.4% above today's price (was 3.5%)`; `Average price in ₹` · `₹15,113 → **₹15,223**` small `Up because $1 costs ₹88.0 today vs ₹83.0 at your earlier buys`; `A 10% move is worth` · `$42 → **$60**` small `≈ ₹3,718 → ₹5,266 · how much your money changes each time the price rises or falls 10%`.
Chain: `Buys so far: **$185.00** → **$179.20** → **$176.00** this order · 3rd buy` small `8 Jan 2026 at ₹82.6/$ · 22 May 2026 at ₹83.4/$ · today ₹88.0/$`.
Footer: `ⓘ ₹ figures use daily USD/INR reference rates on your buy dates. Not a recommendation.`
ⓘ tooltip: `Sources: Alpaca positions & fills (paper), USD/INR live from Upstox global indicator. ₹ figures use daily reference rates on your buy dates, not the rate applied to your transfer.`

## Confirmation sheet (Review buy order)
Title `Order placed · PAYTM` (or `GTT placed · PAYTM`); sub `Buy 3 sh at ₹1,656.00 · Delivery · Sandbox` ; box labelled `Add-More Check · receipt`: `Avg moved **₹2,150.00 → ₹1,985.33**` / `**₹14,904** in PAYTM (9 sh at ₹1,656.00)` / `Your break-even is now ₹1,985.33`; meta line: with sandbox success `Upstox sandbox order <order_id>. Position updated locally — in production this comes from re-fetching holdings after the fill.`; otherwise `Order placement not wired in this demo. Position updated locally.` Holdings table row updates locally after confirm (labelled).

## Data-source labels (always visible, small, top of order panel or footer)
`Live NSE price` · `Real holdings · fetched <HH:MM, D Mon>` · `Trade history · last 3 FYs` ·
`Alpaca paper` · `Live USD/INR (Upstox)` · `Sandbox order` — each chip reflects the actual
source used for the current render (live vs cached). Never show a chip for data not in use.

## Edge cases (must be handled, not hidden)
- Holdings `average_price` missing/0 after a corporate action → hide rows 2–3, show
  `Average unavailable after a corporate action. We won't estimate it.` keep chain.
- Buys older than the trade-history window → chain says `since <start>`; count is `≥ N` only if
  the position predates the window (detect: earliest BUY in window doesn't sum to Q → prefix `at least`).
- T1 shares → include in Q; header subline `incl. N settling`.
- Averaging up → `raises your average to`, gap wording flips automatically.
- Market closed → LTP = last close; show `Last traded Fri 15:30` under the price; card works.
- Token expired (401) → serve cache with `fetched <time>` chip and add a HUMAN_TODO entry.
- Rate limit (429) → exponential backoff, never hammer; LTP polling ≥ 2 s when WS is down.
- US: Alpaca position not yet filled → US tab shows the ticket with `Awaiting first fill
  (orders placed <date>)`; no card; no simulated position.
- USD INR key unresolved → US tab shows `USD/INR feed unavailable` and lists the resolve step in
  HUMAN_TODO; never substitute a typed rate.
- Zero trades in the history window (real case on the demo account: PAYTM = IPO allotment at ₹2,150,
  TMCV/TMPV = Tata Motors demerger). Chain row copy:
  `No buys in your Upstox trade history since Apr 2024 — these shares were bought earlier or came
  another way (IPO, corporate action, transfer).` Omit "Nth buy". Rows 1–3 unchanged.
  First, try fetching from 2023-04-01; if Upstox returns UDAPI1093, keep 2024-04-01.
- Re-entry memory: no sold-out symbol exists in this account. Implement + unit-test it, render it
  only when real data qualifies, and note this in BUILD_REPORT.md. Never seed a fake sell.