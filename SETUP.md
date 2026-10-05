# SETUP — what you do before sleeping (about 40 minutes)

Everything below needs you (logins, OTPs, keys). After step 9 the agent builds on its own.
Commands are PowerShell on Windows; same commands work in a Mac/Linux terminal.

## 0. Tools (10 min, once)
- Node.js 20 or newer: https://nodejs.org (LTS). Check: `node -v`
- Git: https://git-scm.com (on Windows also installs Git Bash, which Claude Code uses for Bash)
- VS Code + the **Claude Code** extension, or the CLI: `npm install -g @anthropic-ai/claude-code`
- Playwright browser for screenshots: `npx playwright install chromium`

## 1. Unzip and open
Unzip `add-more-check-kit.zip` into an **empty** folder, e.g. `C:\dev\add-more-check`. Open that folder in
VS Code. All paths below are relative to it. Run `git init` in it (the agent commits per phase).

## 2. Upstox keys (uncle logged in at account.upstox.com → Developer → My Apps)
1. **Algo Trading tab → + App** (if not done): name anything, Redirect URL exactly
   `https://localhost:3000/callback`. Copy **API Key** and **API Secret**.
2. **Analytics tab → Generate Token**. Copy it. (1 year, read-only, powers all market data.)
3. **Sandbox tab → New Sandbox App → Generate**. Copy the sandbox token. (Optional; order placement flag.)
4. Do **not** add Static IPs (home IPs change; a changed IP invalidates tokens and can only be updated weekly).

## 3. Alpaca paper keys (5 min)
Sign up at https://alpaca.markets → dashboard → switch to **Paper Trading** → **API Keys → Generate**. Copy
Key ID and Secret. Paper only; no money involved.

## 4. Fill `.env.local`
```
copy .env.example .env.local
```
Open `.env.local` and fill: `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, `UPSTOX_REDIRECT_URI`
(`https://localhost:3000/callback`), `UPSTOX_ANALYTICS_TOKEN`, `UPSTOX_SANDBOX_TOKEN` (optional),
`ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`. Leave `UPSTOX_ACCESS_TOKEN` empty — step 5 writes it.
Set `ENABLE_SANDBOX_ORDER=true` only if you generated a sandbox token.

## 5. Daily Upstox login (needs the account holder's OTP — do it while he is awake)
```
node scripts/upstox-login.mjs
```
Open the printed URL, log in (mobile → OTP → PIN), copy the `code=` value from the address bar of the
"can't be reached" page, paste it back. The script saves `UPSTOX_ACCESS_TOKEN`. It expires 3:30 AM IST.

## 6. Cache the real account data (while the token is fresh)
```
node scripts/fetch-upstox-cache.mjs
```
You should see the holdings (e.g. PAYTM 6 @ 2150…) and the trade-history counts. If a symbol shows
"← sold out", the re-entry card has real data to show. Files land in `data/cache/`.

## 7. Resolve instrument keys
```
node scripts/resolve-instruments.mjs
```
Downloads Upstox's instrument files and writes `data/instruments.json` with the keys for your holdings,
the index tickers and (if found) the USD INR global indicator. If it prints `FX: UNRESOLVED`, follow the
printed note (find the Global Instruments file on the Upstox Instruments doc page, search "USD INR", put
the key in `.env.local` as `FX_KEY_OVERRIDE`, re-run). The agent will also try this itself.

## 8. Seed the Alpaca paper position (so the US tab has real fills by Monday)
```
node scripts/alpaca-seed-orders.mjs
```
Places 1 extended-hours limit buy and 1 market buy of AAPL. They fill Monday (pre-market from 1:30 PM
IST, regular from 7:00 PM IST). Until then the US tab honestly shows "Awaiting first fill".

## 9. Verify everything in one go
```
node scripts/check-env.mjs
```
All lines should read `OK` except `alpaca_positions` (0 until Monday) and `sandbox_token` if you skipped it.

## 10. Drop your reference screenshots
Save your Upstox Pro screenshot(s) as `reference/screenshots/upstox-pro-holdings.png` (the one with the
PAYTM Buy ticket open). Optional: `data/watchlist.json` as `["HINDCOPPER","VEDL","RTNPOWER", ...]` so the
left watchlist shows your real list (prices come live from Upstox).

## 11. Launch Claude Code and paste the prompt
Terminal in the project folder:
```
claude --permission-mode bypassPermissions
```
(or in the VS Code extension: open the folder, set permission mode to auto/bypass). When it is ready,
paste the whole contents of `START_PROMPT.md` and press Enter. Accept the Playwright MCP server if asked.
The Stop hook keeps it working until `PROGRESS.md` is complete; `HUMAN_TODO.md` collects anything it
needs from you. Go to sleep.

## 12. Morning
1. Read `PROGRESS.md` (status summary), `HUMAN_TODO.md`, `BUILD_REPORT.md`.
2. Do the HUMAN_TODO items (usually: fresh OAuth token → step 5, re-run step 6), then tell Claude Code:
   "I did HUMAN_TODO items 1–N, continue." It finishes the blocked tasks.
3. Follow `docs/DEMO_RUNBOOK.md` for the demo. Screenshots for the PDF are in `artifacts/screenshots/`.
