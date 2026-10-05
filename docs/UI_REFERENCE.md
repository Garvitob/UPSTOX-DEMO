# UI_REFERENCE

Source of truth: `reference/add-more-check-demo.html` (open it in a browser at 1920×1030; it is the
finalized, approved look) and the human's real Upstox Pro screenshots in `reference/screenshots/`
(`upstox-pro-holdings.png` etc.). Port the CSS from the reference file verbatim where possible —
same tokens, same font (Inter via Google Fonts with system fallback), same widths:
left watchlist 318px, order panel 360px, right rail 44px, ticker 38px, top bar 46px.

## Order flow — exactly like Upstox Pro (human's START RULE, 2026-10-04; overrides the reference where they differ)
Reference: the human's own pro.upstox.com screenshots —
`reference/screenshots/upstox-pro-row-buy-sell-hover.png`, `upstox-pro-exchange-modal.png`,
`upstox-pro-order-panel-open.png` (and `upstox-pro-gtt.png` for the GTT footer).
1. The holdings page opens with **no** Place Order panel; the table runs up to the right rail.
2. Hovering a holdings row shows **Buy** (green outline), **Sell** (red outline) and **⋮** at the row's right end;
   watchlist rows show **B / S** on hover.
3. Buy or Sell opens the dialog **"Exchange to Buy From"** / **"Exchange to Sell From"** — "Which exchange would you like
   to buy PAYTM EQ from?" — with one option per exchange the stock trades on: NSE / BSE, "PAYTM EQ", the live LTP
   (coloured by its change) and "-22.00(-1.31%)" from that exchange's LTP v3 / feed quote. A single-exchange stock
   skips the dialog. (PICCADIL sits in the watchlist as "BSE B" but is also listed on NSE, so it gets the dialog.)
4. Picking an exchange slides in the **Place Order** panel ("Place Order" header, pin, ✕): that exchange's radio is
   selected (and can be switched), quantity 1, Regular, Market. ✕ closes it; the rail's cart icon (purple while open)
   reopens it.
5. Footer and button come from real data: **Required** = Margin API for the exact order (side, product, qty, price);
   on Regular/MTF the right side is **Available** = Funds API; when Required > Available on a BUY the panel shows
   "You've insufficient funds to buy PAYTM. To continue, add funds." and the purple **Add funds** button. GTT shows
   "With MTF: ₹ …" and **Review buy order** (no funds are blocked for a GTT). Upstox's Funds service is closed
   00:00–05:30 IST (UDAPI100072): the chip strip then says "Upstox funds service closed · opens 5:30 AM IST" (time read
   from Upstox's message), Available shows "—", and a BUY is not blocked while the balance is unknown.
6. A **Sell** ticket: Regular and GTT tabs, no MTF row, no Add-More card (a buy-side feature), red **Review sell order**.
7. Ticket body as in the human's screenshots: the quantity/price row is two equal columns, each an input plus a small ⇄
   square, under one purple label row "Quantity ⌄ · Market ⌄ · + Trigger" (typing a price turns Market into Limit; the
   insufficient-funds line sits under the inputs). GTT: Quantity + Side [Buy | Sell], the MTF row, the card, "Place order ·
   If price is below ⌄", "₹ 1651.90 ⇄ 0.25 %" (both on the tick grid, from the live LTP) and the T&C line.
8. The source chips sit in one strip directly above the Required / Available footer. The price chip names the exchange
   the ticket trades on, from that exchange's own market status ("BSE closed · last traded Thu 15:56").
9. **No India/US switch in the panel** (human, 5 Oct): the pressed stock decides the ticket. Indian stocks (holdings or
   watchlist → NSE/BSE) open the Upstox ticket; **Buy / Sell on a row of the holdings "US Stocks" tab** opens the US
   ticket. The holdings tabs (Stocks / Mutual Funds / US Stocks — no "extension" pill) change only the table, never an
   open ticket.
The Add-More Check card sits under the MTF row of every BUY ticket on a held (or sold-out) stock, as before.

## Screens to replicate (desktop)
- Ticker bar (NIFTY 50 / BANKNIFTY / SENSEX) — values from LTP v3 on `NSE_INDEX|Nifty 50`,
  `NSE_INDEX|Nifty Bank`, `BSE_INDEX|SENSEX` (resolve keys from instruments; if an index key fails, show "—").
- Top bar: logo tile, Hol. Total P&L (sum of holdings `pnl`), Pos. Total P&L (positions sum or 0.00),
  nav with Holdings active, search, Funds, avatar initials (from `DEMO_ACCOUNT_LABEL` initials), grid.
- Watchlist (left): the human's watchlist names from the screenshot are not available via API —
  render the holdings' symbols plus any symbols listed in `data/watchlist.json` if the human provides
  one (HUMAN_TODO optional); otherwise show the holdings only. Prices from LTP v3. Never fabricate
  prices for symbols you did not fetch.
- Holdings table: columns Symbol, Qty., Avg. price, LTP, Day P&L, Day %, Overall P&L, Overall %,
  Current, Invested — all from the Holdings API + LTP; summary strip computed from the rows.
- Place Order panel: exactly as the reference (tabs Regular/GTT/MTF 3.2X, Delivery/Intraday,
  Quantity stepper, Market/Limit price box, "+ Trigger", MTF row, **the card**, Market depth,
  Additional settings, markets-closed note, Required/With MTF footer, green Review button).
  MTF multiplier and "Buy for ₹X/share with MTF" use the ticket's own numbers (Required × 0.3157 as
  in the reference is a placeholder ratio — replace with the real figure from the brokerage/margin API
  if available, else hide the MTF row's rupee figure rather than invent it).
- No India/US switch in the panel: the US ticket opens from Buy / Sell on a row of the holdings "US Stocks" tab (see
  "Order flow" 9); US card per SPEC.
- Holdings "Invested" = (quantity + t1) × last_price − pnl of the Holdings snapshot — Upstox's own figure (TMCV 4,865.01).
- Phone layout (<900px): only the order panel, full width, with the stock selector dropdown.

## Screenshot protocol (Playwright MCP, headless Chromium)
Viewport 1920×1030, device scale 1, light theme. Capture to `artifacts/screenshots/` with these names:
```
p3-shell.png                  shell with holdings loaded, no stock selected card state
p4-card-collapsed.png         PAYTM (or first loss-making holding) selected, card collapsed
p4-card-expanded.png          same, expanded
p4-card-avg-up.png            a holding in profit selected, expanded
p4-no-card.png                a never-held symbol selected (ticket identical to Upstox)
p5-gtt.png                    GTT tab, expanded, trigger edited
p5-mtf.png                    MTF tab
p5-reentry.png                sold-out symbol selected (if one exists in trade history; else note why)
p6-live.png                   price chip showing live/last-traded state
p7-us-card.png                US tab, card expanded
p8-confirm.png                confirmation sheet after Review buy order
p9-phone.png                  viewport 390×844, order panel only
p12-*.png                     the Upstox flow: start, hover, exchange-modal, panel-open, panel-bse, gtt, gtt-above,
                              sell-modal, sell-panel, sell-confirm, watchlist-bs, piccadil-modal, us-tab, us,
                              tab-switch, in-after-us, hover-panel-open (add-funds needs the Funds service hours
                              05:30–24:00 IST and a live token)
ref-card-expanded.png         the reference HTML at the same state for side-by-side
```
`qa-visual` compares each build screenshot against the reference at the same state and reports
pixel-level deviations that matter (spacing, alignment, font weight, colours, truncation, overflow,
horizontal scrollbars). A horizontal scrollbar inside the order panel is always a BLOCK.
