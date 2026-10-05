# Add-More Check: PM take-home

**Video:** <paste link> · Garvit · 5 Oct 2026

## The problem
One moment, one missing fact. Someone adds to a stock they already hold, often after a fall. The Upstox Pro BUY ticket
shows them price, quantity and margin, but not what the order does to their position: the new average, the new
break-even, and the extra money riding on every swing.

## The feature
A card under the MTF row of the BUY ticket, shown when the user already holds the stock. Collapsed, it is one line. With 6 PAYTM
held at ₹2,150.00 and a last price of ₹1,656.00, buying 1 reads **After this order · Avg ₹2,150.00 → ₹2,079.43**.
Expanded:

> Buying **1 more at ₹1,656.00** lowers your average to **₹2,079.43** and puts **₹1,656** more into PAYTM.

| Row | Before → after |
|---|---|
| Shares | 6 → **7** |
| Average price | ₹2,150.00 → **₹2,079.43** · *Break-even · 25.6% above today's price (was 29.8%)* |
| A 10% move is worth | ₹994 → **₹1,159** |
| Buy history | *No buys in your Upstox trade history since Apr 2024 — these shares were bought earlier or came another way (IPO, corporate action, transfer).* |

Footer: *Based on your holdings and the live NSE price. Charges excluded. Not a recommendation.* It recalculates on every
input. Variants cover GTT, MTF, re-entry (a stock sold out earlier) and US stocks.

## What is real
- **Upstox Developer API with real market data, on a real family account.** Holdings (Upstox's `average_price` is the
  truth), Trade History, LTP v3 and the WebSocket feed, the Margin API (Required; MTF ₹522.80/share, 3.2X) and the
  Funds API (Available).
- **Alpaca paper API** for US stocks, with USD/INR from Upstox's live feed.
- **Upstox sandbox orders** with real order IDs (e.g. SELL `261005004706750`). No money moves.
- **Audit by the AI CTO reviewer.** 176 on-screen numbers in 14 states were recomputed from the raw Upstox and Alpaca
  APIs, and **176/176 matched**. `src/` has no hardcoded prices, quantities, averages or FX rates.

## How it was built and checked
Built with Claude Code (Next.js 14, TypeScript) from `docs/SPEC.md` and an approved design, inside a replica of the
Upstox Pro flow (hover → Buy → NSE/BSE → Place Order). Every phase ended in a gate of AI reviewers with fixed roles
(visual QA, CPO, Senior PM, CTO), on Playwright screenshots once there was a screen. Blocking findings were fixed before moving on. 114 unit
tests; 0 of 7 secrets in any bundle.

## Decisions and trade-offs
- **Facts, no advice.** No recommendation and no judgement colours; tests reject advice words.
- **Collapsed by default.** One line, the average before and after this order, so the ticket stays as fast as today.
- **The card never blocks an order.** The button follows Upstox's own Required and Available figures, as Upstox does.
- **Never held, no card.** The ticket stays identical to Upstox's.
- **Gaps stated, never filled.** Missing history is said plainly; an average lost to a corporate action is hidden, not
  estimated; charges are excluded, and labelled.
- **Variants follow each product's rules.** A GTT is measured against its trigger. An MTF lot leaves the delivery
  average unchanged. The US card shows dollar and rupee averages, because the exchange rate moves too.
- **Money, not only percentages.** "A 10% move is worth ₹994 → ₹1,159" shows how much more money each swing moves
  after the order.

## What to look at
Watch the video first (3–4 minutes, recorded in Monday's live session). The screenshots in `artifacts/screenshots/`
were taken before Monday's open, at the last close:
1. `p12-panel-open.png`: the collapsed card, one line
2. `p4-card-expanded.png`: the rows
3. `p4-card-avg-up.png`: TMCV in profit, where the card reads "raises your average to ₹330.03"
4. `p12-gtt-card-expanded.png`: GTT, with the trigger as the reference
5. `p12-sell-confirm.png`: a real Upstox sandbox order ID

Also see `p7-us-card.png` (the US card on the first AAPL paper fill, taken Monday in the overnight session), `p5-mtf.png`
and `p9-phone-expanded.png`. `artifacts/API_MAP.md` maps every value to its endpoint.
Files named `ref-*.png` are the approved design reference with its sample data, and `superseded/` holds replaced
captures; neither shows the build. `classic-*.png` show the same build with classic Windows scrollbars.

## Pending, and why
- **US card on a real fill: done.** The AAPL extended-hours paper buy filled in Alpaca's overnight session (1 share at
  $333.47, 05:30 IST Monday), so the US card shows real dollar and rupee averages (`p7-us-card.png`). Its lot uses
  today's live USD/INR until Upstox has the day's close. The second paper buy (a market order) fills at the US open,
  7:00 PM IST.
- **Add funds.** The real balance is ₹0.00, so a Regular or MTF buy shows Upstox's own "Add funds" (in the video and
  `p12-add-funds.png`, captured live on Monday).
  Screenshots taken while Upstox's Funds service was closed (00:00–05:30 IST) show "Available: —". While the Funds
  service is closed there is no balance to check, so the Regular buy in `p8-confirm.png` reached the sandbox.
- **Re-entry card.** It needs a stock sold out of, and this account has no trades since Apr 2024, so it is unit-tested
  but never rendered or seeded.

## Run it locally
1. `npm install`
2. `.env.local` from `.env.example`: Upstox app keys, Alpaca paper keys (`SETUP.md`).
3. `node scripts/upstox-login.mjs`: the daily OTP login. The token expires at 03:30 IST.
4. `node scripts/check-env.mjs`: every line reads OK.
5. `npm run dev`, then open http://127.0.0.1:3000 and hover a holding → Buy → NSE.

Not deployed publicly: it shows a real account's holdings.

## What I would measure
- Card open rate on held-stock BUY tickets.
- Completion and size of add-on orders against control. The aim is better-informed orders, not more or fewer.
- Guardrail, watched rather than steered: how often the same stock is averaged down again within 30 and 90 days.
- Support tickets about "my average changed".
