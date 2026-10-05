You are building "Add-More Check" end to end, autonomously, in this repository. Work until it is done.

## Mission
A card inside the Upstox Pro BUY ticket that shows what an order does to a position the user already holds
(shares, average, break-even, money at stake, buy history), with a GTT variant, an MTF variant, a re-entry
line for stocks sold earlier, and a US-stocks version showing the dollar average and the rupee average side
by side. It must run on the REAL Upstox Developer API with REAL market data, and the US tab on the REAL
Alpaca paper API with Upstox's live USD/INR. The UI must look exactly like `reference/add-more-check-demo.html`
(which is the approved design) — but every number must come from an API, not from code.

## Before anything else
1. Read, in full: `CLAUDE.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/API_UPSTOX.md`,
   `docs/API_ALPACA.md`, `docs/UI_REFERENCE.md`, `docs/PHASES.md`, `PROGRESS.md`, `HUMAN_TODO.md`.
   Then open `reference/add-more-check-demo.html` and read its CSS and JS — that file is the UI spec and
   its `compute()` function is the maths; you will port both.
2. Run Phase 0 (preflight) exactly as `docs/PHASES.md` describes, using the scripts in `scripts/`.
   Record real values in `PROGRESS.md`. Anything missing that only the human can supply goes into
   `HUMAN_TODO.md` with exact steps; mark the dependent task `(blocked:human)`; keep going.

## Hard rules (repeat them to yourself at every phase)
- Real data only. No hardcoded prices, holdings, trades, FX, personas, mock branches or `Math.random` in `src/`.
  If data is unavailable, render a labelled unavailable/awaiting state. Never invent.
- Pixel fidelity to the reference. Port its CSS. Same widths, fonts, spacing, copy, states. No redesign.
- Scope exactly as `docs/SPEC.md`. No extra rows, no charts, no recommendations, no forbidden words.
- Tokens only on the server. Market data via the Analytics token; holdings/trades via the OAuth token with
  the cache fallback; sandbox orders via the sandbox token on `https://sandbox.upstox.com` behind
  `ENABLE_SANDBOX_ORDER`, with an identical fallback sheet on any failure.
- Market closed is normal: show "Last traded …", keep everything working.
- Verify, don't assume: curl the real endpoints, compare rendered numbers to raw JSON by hand.

## Scaffolding note
This folder is not empty, so `create-next-app` will refuse to run in place. Either scaffold into
`./_scaffold` and move its contents into the root (merge, do not overwrite kit files, then delete
`_scaffold`), or write `package.json`/`next.config.mjs`/`tsconfig.json`/`tailwind.config.ts`/
`postcss.config.mjs` by hand and `npm install`. Pin: next@14, react@18, typescript@5, tailwindcss@3,
vitest, ws, protobufjs. Use the `src/` layout from `docs/ARCHITECTURE.md`.

## How to work
- Follow `docs/PHASES.md` in order. One phase at a time. Small commits (`git add -A && git commit -m "phase N: …"`).
- Keep `PROGRESS.md` current: `[~]` when you start a task, `[x]` with a one-line note and screenshot name
  when done, and update the "Status summary" (Done / In progress / Left) and the dated Build log at every gate.
- At the end of EVERY phase run the review gate: take the screenshots listed in `docs/UI_REFERENCE.md` with the
  Playwright MCP (also capture the reference HTML at the same state), then invoke the subagents in this order
  and paste their verdicts into PROGRESS.md: `qa-visual` → `cpo` → `spm` → `cto`. Fix every BLOCK before
  moving on. The `cpo` agent decides product/copy/scope questions; the `cto` agent decides technical ones.
  If an agent reports BLOCKED_BY_HUMAN, record it in HUMAN_TODO.md and continue with the next unblocked work.
- If something only the human can do stops a task (expired OAuth token, missing key, unresolved USD INR key,
  Alpaca fills not yet landed, a screenshot of the real app), write it to `HUMAN_TODO.md` with the exact
  steps and continue with everything else. Never simulate the missing data to "finish".
- Do not stop until every task in `PROGRESS.md` is `[x]` or `(blocked:human)`. Then write `BUILD_REPORT.md`
  (what was built, what is live vs cached, what is blocked and why, how to run the demo per
  `docs/DEMO_RUNBOOK.md`) and create the file `.build-complete`. A Stop hook enforces this.

## Definition of done
- `npm run build` and `npm test` green.
- Every card value traces to an endpoint in `artifacts/API_MAP.md` (row → endpoint → fields → token).
- All screenshots in `artifacts/screenshots/` per `docs/UI_REFERENCE.md`, each passed by `qa-visual`,
  `cpo`, `spm`, `cto` (verdicts in PROGRESS.md).
- No horizontal scrollbar anywhere in the order panel; phone layout works.
- The app runs with `npm run dev` on http://localhost:3000 using only `.env.local`.

Start now with Phase 0. Report progress only through PROGRESS.md and HUMAN_TODO.md; keep chat output short.
