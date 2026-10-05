# HUMAN_TODO — things only Garvit can do

## Setup status
**READY TO BUILD: yes** (verified by the agent 2026-10-04 12:57 IST — every `check-env` line OK; see PROGRESS.md → Preflight)

The agent appends here whenever it is blocked. Each entry: what, why, exact steps, which PROGRESS task it
unblocks. Garvit: do the step, then tell Claude Code "I did HUMAN_TODO item N, continue".

## Open

1. **Monday before the demo — fresh Upstox login** (the OAuth token expires 3:30 AM IST every day).
   ```
   node scripts/upstox-login.mjs
   node scripts/fetch-upstox-cache.mjs
   ```
   Open the printed URL, log in (mobile → OTP → PIN), paste the `code=` value back. Without it the app still runs:
   holdings come from the cache with a `fetched <time>` chip, and the MTF rupee figures are hidden (they need a live
   margin call). Unblocks: live holdings + MTF figures on demo day.

2. ~~**US card with real fills.**~~ **Done (agent, 05:31 IST Mon 5 Oct):** the extended-hours limit buy filled in Alpaca's
   overnight session (1 AAPL @ $333.47); the US card renders on real data (`p7-us-card.png`). The market buy fills at the
   US open (7:00 PM IST), after the deadline. Nothing to do.

3. **Decide on the Next.js security advisory (CTO, BLOCKED_BY_HUMAN).** The kit pins Next 14. Next 14.2.35 (the newest 14.x)
   is affected by GHSA-p293-qw3h-jr36 ("Unauthenticated RCE on Windows-hosted servers", critical), which is fixed only in
   Next ≥ 15.5.24. The agent has already applied mitigations: `npm run dev` / `npm start` listen on 127.0.0.1 only, so nothing
   on your network can reach the server; the image optimizer is off; there is no middleware, rewrite or Server Action.
   Vercel runs Linux, where the Windows RCE does not apply. Pick one:
   - **(a) Keep Next 14 with the mitigations (agent's recommendation for the demo).** No action needed.
   - **(b) Upgrade to Next 15.5.24.** Tell Claude Code "upgrade Next to 15.5.24". That needs React 19 and a re-run of all gates,
     and it deviates from the kit's pinned stack.

4. **Before the first Vercel deploy: approve what gets published.** The page shows the account's real holdings, so turn on
   Vercel Deployment Protection first (see DEPLOY.md).
   - **From GitHub** (github.com/Garvitob/UPSTOX-DEMO, public): there is no cache, so once the token expires the app shows a
     labelled "unavailable" state.
   - **CLI deploy from this folder:** it also bundles `data/cache/*.json`, the real holdings snapshot used as the
     expired-token fallback. To leave the snapshot out, add `data/cache/` to `.vercelignore`.

   Unblocks: PROGRESS Phase 11 "First deploy to Vercel".

5. **Optional — the BUY confirmation during Upstox's Funds service hours.** The ticket works exactly like Upstox Pro: it
   reads your real balance from the Upstox Funds API, and with ₹0.00 available a Regular/MTF buy shows "You've
   insufficient funds to buy PAYTM. To continue, add funds." and **Add funds**, as in your own screenshot. The Add-More
   card still shows in full. Selling, or a GTT buy, always reaches the confirmation (a sell places a real Upstox sandbox
   order). Upstox's Funds service is closed every night 00:00–05:30 IST (error UDAPI100072); in those hours the ticket says
   so, shows "Available: —" and does not block a buy, so the buy confirmation (p8-confirm) was captured then. If you also
   want the *buy* confirmation in the daytime, add at least the order's "Required" amount (₹1,656 for 1 PAYTM) to the
   Upstox account before the demo; nothing in the app changes. Unblocks: nothing; it is a demo choice.

6. ~~**Re-capture the "Add funds" state.**~~ **Done (11:56 IST Mon 5 Oct, after your login):** live Funds API ₹0.00 → "You've
   insufficient funds to buy PAYTM. To continue, add funds." + Add funds (`p12-add-funds.png`, `p12-panel-open.png`).

7. **Before sharing the repo: the account holder's full name in git history.** The CTO audit (gate run 2) found the
   profile's real full name used as the example in a code comment and a unit test since commit a204694. It is removed
   from the current code (neutral example "ASHA RAO" → "AR"); the app only ever shows initials, and the CTO confirmed it is
   in no build output, API response or file at HEAD. It is still inside the file snapshots of the commits from a204694 up
   to (not including) d7dbe21 — 24 of the 28 commits — though in no commit message, and the repo has no remote. If the
   repository will be shared outside the family, decide whether to rewrite history (for example
   `git filter-repo --replace-text`); the agent does not rewrite history without your OK. Unblocks: nothing in the build.

## FYI (done by the agent, no action needed)
- `.env.local`: `UPSTOX_SANDBOX_BASE` changed to `https://api-sandbox.upstox.com` — the kit's `sandbox.upstox.com`
  does not exist in DNS; the official Upstox SDK and a live sandbox order (ID 261004130028974) confirm api-sandbox.
  If your editor still has `.env.local` open, reload it before saving so this line is not reverted.
- `data/watchlist.json`: the 14 symbols visible in your Upstox Pro screenshot (Upstox has no watchlist API). Edit the
  list if you want different names, then run `node scripts/resolve-instruments.mjs`. Prices are always live.
- Reference screenshots copied to `reference/screenshots/upstox-pro-holdings.png` and `upstox-pro-gtt.png`.

## Done
- 2026-10-04 — Setup items 1–5 (Upstox keys, Alpaca paper keys, login + cache, Alpaca seed orders, reference
  screenshots) — confirmed working by the agent's live checks.
