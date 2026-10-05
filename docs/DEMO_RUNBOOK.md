# DEMO RUNBOOK — Add-More Check (presenter's script)

## 30 minutes before (Monday)
1. `node scripts/upstox-login.mjs`. This needs the account holder's OTP once and writes a fresh `UPSTOX_ACCESS_TOKEN`, valid
   until 3:30 AM Tuesday.
2. `node scripts/fetch-upstox-cache.mjs`. This refreshes the fallback snapshot.
3. `node scripts/check-env.mjs`. Every line should read `OK`. `alpaca_positions` shows the AAPL fills once they have landed
   (pre-market from 1:30 PM IST, regular session from 7:00 PM IST).
4. `npm run dev`, then open http://127.0.0.1:3000 in Chrome at full screen (1920×1080 looks exactly like the screenshots).
5. In a second terminal, run `node scripts/verify-card.mjs 3` (the card at 3 shares; `1` for the default quantity). Keep it visible: it is your "this is real" proof.
6. Optional: `node scripts/serve-reference.mjs`, then http://127.0.0.1:3100 shows the approved design next to the build.

Open any ticket (hover PAYTM → Buy → NSE) and check the chip strip above the Required / Available footer: `Real holdings (family account) ·
fetched <now>`, plus `Live NSE price` during market hours or `NSE closed · last traded …` outside them.

## The 5-minute demo (the Upstox Pro flow, real data only)

| # | Do | Say |
|---|---|---|
| 1 | Land on Holdings. No order panel is open, exactly like Upstox Pro. Point at the ticker, P&L and holdings. | "This is Upstox Pro with one addition. Every number on this page is live from the Upstox Developer API on a real family account. Nothing is typed in." |
| 2 | Hover **PAYTM**. **Buy / Sell / ⋮** appear. Click **Buy**. | "Same flow as Upstox: hover, Buy, and it asks which exchange. Both prices are live: NSE 1,656.00, BSE 1,664.80, each with its own day change." |
| 3 | Pick **NSE**. The Place Order panel slides in with the card **collapsed**. Point at "Avg ₹2,150.00 → ₹2,079.43" and the chips. | "Someone adding to a losing position sees one line: what this order does to their average. The chips say where each number came from, right now." |
| 4 | Point at the red line, "Available: ₹ 0.00" and **Add funds**. | "That's this account's real balance from the Upstox Funds API, and the Margin API's real requirement. Upstox shows exactly this. The card still tells you what the order would do before you fund it." (Between 00:00 and 05:30 IST Upstox's Funds service is closed: the chip says so, Available shows "—" and the button stays **Review buy order**.) |
| 5 | Click the card, then type **3** in Quantity. | "Expanded, it answers five questions in ten seconds: shares, new average, break-even vs today's price, what a 10% move is worth in rupees, and buy history. At 3 shares it's ₹1,985.33. It recalculates as you type. Facts only, never 'buy' or 'don't'." |
| 6 | Point at "No buys in your Upstox trade history since Apr 2024 …". | "That line is real. The average is exactly ₹2,150, PAYTM's IPO price, and Upstox's 3-year trade window has no PAYTM trades. The card says so instead of inventing a history." |
| 7 | Click the **BSE** radio in the panel. | "Switch exchange and the price, the requirement and the card follow BSE's live quote. The chip and the card's footer now say BSE, from BSE's own market status." |
| 8 | **GTT** tab. Type **0.50** in the % box. | "For GTT the reference price is the trigger, so the card reads 'If this GTT fires'. Upstox's default is 0.25 % under the live price: ₹ 1651.90. Type a percentage and the trigger moves on the tick grid; the card follows. The footer is Upstox's own: Required ₹1,651.90, With MTF ₹521.50, Review buy order." |
| 9 | **MTF** tab. | "MTF lots are funded separately and leave the delivery average unchanged. ₹522.80/share and 3.2X come live from Upstox's margin API." |
| 10 | Close with ✕. Hover **TMCV** → Buy → NSE → expand. | "In profit, the wording flips on its own: *raises* your average, break-even *below* today's price." |
| 11 | Watchlist: hover **VEDL** → **B** → NSE. | "Not held, so there's no card. The ticket is exactly today's Upstox. We don't add noise where there's nothing to say." |
| 12 | Hover **PAYTM** → **Sell** → NSE → **Review sell order**. | "Selling needs no funds, so this goes through. It's a real order on the Upstox **sandbox**; that's the order ID. Add-More is a buy-side card, so the sell ticket stays exactly Upstox's." |
| 13 | **US Stocks** holdings tab → hover the row → **Buy** (or **Sell** once Alpaca reports a position). | "There's no India/US switch: the stock you press decides the ticket." | After fills: "Same card for US stocks. Here the dollar average falls but the rupee average can rise, because the rupee moved since the buys. Prices come from Alpaca paper; USD/INR comes from Upstox's live feed. The chip names the exact key, `GLOBAL_INDICATOR\|USDINR`, and each buy uses that day's close." Before fills: "The Alpaca paper orders fill at the US open. Until then we say *Awaiting first fill*. No simulated position." |
| 14 | Shrink the window to phone width. | "On a phone it's the order panel with a stock picker. Same card." |
| 15 | Point at the terminal running `verify-card.mjs`. | "These numbers were recomputed from the raw Upstox JSON by a script that shares no code with the app. They match to the paisa." |

## Questions you may get, with crisp answers

- **Why no recommendation?** "Upstox is a broker, so advice is regulated. And the insight isn't 'should I'. It's that
  people can't see what averaging down does to their break-even and their risk. We show the facts at the moment of
  decision and leave the decision to them."
- **Why a 10% move in rupees?** "Percentages hide size. ₹994 → ₹1,490 makes the extra exposure concrete without
  predicting anything."
- **Why collapsed by default?** "So the ticket isn't slower for people who don't care. The header line gives the
  one-number answer, and one click shows the rest."
- **Edge cases?** "We handle each one explicitly:
  - IPO or demerger shares with no trade history.
  - Average missing after a corporate action: we hide rather than estimate.
  - T1 settling shares.
  - Same-day buys and sells, which net per Indian settlement.
  - Stocks you sold out of: a re-entry card. It's tested, but this account has no such stock, so it doesn't appear.
  - An expired token: a labelled cache.
  - Market closed: the last-traded time is shown."
- **How do I know it's real?**
  - Run `verify-card.mjs`.
  - Open DevTools → Network: `/api/holdings`, `/api/ltp`, `/api/stream`, `/api/margin`, `/api/fx`.
  - Look at `artifacts/API_MAP.md` (row → endpoint → field → token).
  - Run `node scripts/scan-secrets.mjs`: tokens never reach the browser.
- **What would you measure?** Card expansion rate on held stocks. Average-down orders placed or abandoned after
  viewing. Change in order size versus control. 30/90-day outcomes for averaging-down cohorts. Support tickets about
  "my average changed".
- **What's next?** A charges-inclusive break-even, opt-in. Concentration as a separate, CPO-gated experiment. Fetching
  holdings again after a fill in production, instead of the local update.

## If something is down
- **Upstox 401 (token expired):** holdings and trades come from the cache, the chip says `cached <time>`, and the banner says why
  (token not accepted / rate limited, retrying / Upstox unreachable). Say so out loud.
- **Feed silent:** a connection that answers nothing for 25 s is dropped and reconnected (Upstox pings every ~5 s), and after
  10 s down the page polls LTP every 2 s; the chip says `polling`.
- **Alpaca empty:** the US tab shows *Awaiting first fill*. Explain the fill timing.
- **Sandbox down (00:00–05:30 IST, or any error):** you get an identical sheet without an order ID ("Order placement not wired in this demo").

## Screenshots for the PDF
Use `artifacts/screenshots/*.png`, and the Network panel showing `/api/holdings`, `/api/trades`, `/api/ltp`, `/api/stream`,
`/api/us/*` and `/api/fx` responses. For the competitor-audit slide, take your own screenshots of the Buy ticket for a held
stock in Upstox, Kite, Groww, Dhan and INDmoney. Nothing in the build fabricates them.
