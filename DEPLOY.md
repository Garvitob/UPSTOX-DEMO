# Deploying Add-More Check to Vercel

The app is a standard Next.js 14 project, so Vercel runs it as-is. A few things work differently from
`npm run dev` on your laptop. This page covers them, then gives the exact commands.

## What changes on Vercel

| Area | Laptop (`npm run dev`) | Vercel |
|---|---|---|
| Upstox / Alpaca calls | Route handlers on your machine | Route handlers in Vercel Functions, pinned to **`bom1` (Mumbai)** by `vercel.json` |
| Tokens | `.env.local` | Project environment variables. The CLI never uploads `.env.local`. |
| Live prices | One long-lived Upstox WebSocket feeds `/api/stream` (SSE) | `/api/stream` stays open for up to 300 s per request (the Hobby limit) and then closes cleanly. The browser reconnects within 2 s. If the feed stays down for more than 10 s, the page polls LTP v3 every 2 s. |
| Holdings / trades fallback | `data/cache/*.json` (written by `scripts/fetch-upstox-cache.mjs`) | **CLI deploy:** the same files are uploaded with the deployment, because the CLI ignores `.gitignore`. **GitHub deploy:** none, because `data/cache/` is git-ignored. Runtime refreshes go to the function's temp dir. |
| HUMAN_TODO entry on an expired token | Appended to `HUMAN_TODO.md` | Logged in the function logs (read-only filesystem) |

Every number is still a real API value. When the OAuth token has expired, a CLI deploy labels the
cached holdings `cached <time>`, the same way the laptop does. A GitHub deploy has no cache, so it shows
holdings and trade history as unavailable, with the reason. Market data stays live either way, because the
Analytics token lasts a year.

## From GitHub (Vercel dashboard, no CLI)

The public copy is [github.com/Garvitob/UPSTOX-DEMO](https://github.com/Garvitob/UPSTOX-DEMO). It is one
commit with no history, and it leaves out the real Upstox screenshots in `reference/screenshots/`.

1. On vercel.com, click **Add New… → Project** and **Import** `Garvitob/UPSTOX-DEMO`. The framework preset is
   **Next.js**. Leave Root Directory, Build Command and Output Directory at their defaults. `vercel.json` pins
   the functions to `bom1`.
2. Under **Environment Variables**, add these keys with the values from your local `.env.local`:
   `UPSTOX_ANALYTICS_TOKEN`, `UPSTOX_ACCESS_TOKEN`, `UPSTOX_SANDBOX_TOKEN`, `UPSTOX_SANDBOX_BASE`,
   `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_PAPER_BASE`, `ALPACA_DATA_BASE`, `US_SYMBOL`,
   `ENABLE_SANDBOX_ORDER` and `DEMO_ACCOUNT_LABEL`. Add `FX_KEY_OVERRIDE` only if you set it. Leave out
   `UPSTOX_API_KEY`, `UPSTOX_API_SECRET` and `UPSTOX_REDIRECT_URI`, because only the local login script uses them.
3. Click **Deploy**. Turn on Deployment Protection (below) before you share the link.
4. Every morning (the OAuth token expires at 3:30 AM IST), run `node scripts/upstox-login.mjs` on your laptop.
   Paste the new `UPSTOX_ACCESS_TOKEN` into Project → Settings → Environment Variables, then open
   Deployments → ⋯ → **Redeploy**. Environment changes apply only to a new deployment. A push to `main` also
   redeploys.

## From this folder (Vercel CLI): one-time setup

```powershell
npx vercel login                      # opens the browser; use your own Vercel account
npx vercel link                       # create or link the project in this folder (framework: Next.js)
node scripts/vercel-env-push.mjs      # copies the runtime keys from .env.local; values are never printed
```

`vercel-env-push.mjs` pushes only the keys the server needs at runtime: Analytics, OAuth and Sandbox tokens,
the sandbox base, the Alpaca paper keys, `US_SYMBOL`, `ENABLE_SANDBOX_ORDER`, `DEMO_ACCOUNT_LABEL` and
`FX_KEY_OVERRIDE`. It does **not** push `UPSTOX_API_KEY` / `UPSTOX_API_SECRET`, because only the local
login script uses them.

**Turn on Deployment Protection before you share the link**: Project → Settings → Deployment Protection →
Vercel Authentication, or Password Protection on Pro. The page shows the real holdings of the account in
`.env.local`.

## Every CLI deploy (and every morning: the OAuth token expires at 3:30 AM IST)

```powershell
node scripts/upstox-login.mjs                         # fresh UPSTOX_ACCESS_TOKEN (needs the account holder's OTP)
node scripts/fetch-upstox-cache.mjs                   # refresh the bundled fallback cache
node scripts/vercel-env-push.mjs UPSTOX_ACCESS_TOKEN  # update just the token on Vercel
npx vercel deploy --prod                              # environment changes only apply to a new deployment
```

If you skip the morning login, the deployed app still works. Holdings and trade history come from the
bundled cache (labelled), market data stays live (the Analytics token lasts a year), and the MTF rupee
figures are hidden because they need a live Margin API call.

## Things to know

- **Upstox WebSocket limit:** a standard Upstox user gets 2 feed connections. Your laptop and the Vercel
  deployment each hold one while they are open. If ticks stop, close the other one. The page keeps working
  on 2 s polling either way.
- **Sandbox orders:** with `ENABLE_SANDBOX_ORDER=true`, "Review buy order" posts to
  `https://api-sandbox.upstox.com` (no real money). The code refuses any host that is not a `*sandbox*.upstox.com`
  host. GTT is never sent (the sandbox has no GTT). The US tab never places an Alpaca order. `POST /api/order`
  accepts only same-origin JSON (a cross-site form or text/plain post gets 403), so another site cannot place
  sandbox orders through your deployment. Alpaca calls refuse any host but `paper-api.alpaca.markets`.
- **Abuse limits:** `/api/stream` takes at most 100 instrument keys per request and the feed subscription is
  capped at 300 keys; `/api/ltp` validates keys against the instrument master.
- **Security:** the project is pinned to Next 14 (kit requirement). Next 14.2.35 has open advisories that are
  fixed only in Next ≥ 15.5.24. The app avoids every affected feature: the image optimizer is off
  (`images.unoptimized`), and there is no middleware, rewrite, Server Action or WebSocket-upgrade route.
  The Windows-host RCE does not apply on Vercel's Linux runtime. Keep Deployment Protection on anyway.
- **Region:** `vercel.json` pins functions to `bom1`. Calls to Upstox then originate in India with the lowest
  latency.
- **Function duration:** `/api/stream` asks for 300 s (`maxDuration`). New Vercel projects allow that on every
  plan, because Fluid compute is on by default. If a build ever stops on `maxDuration`, turn on Fluid compute
  under Project → Settings → Functions.
