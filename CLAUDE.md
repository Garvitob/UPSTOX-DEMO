# Add-More Check — build constitution

You are building ONE feature for a PM take-home: **Add-More Check**, a card inside the Upstox Pro
BUY ticket that shows what an order does to a position the user already holds. The build must run
on the **real Upstox Developer API with real market data**, with a US-stocks extension on the
**real Alpaca paper API** plus Upstox's live USD/INR. Nothing on screen may be hardcoded.

Read these before writing any code, in this order:
1. `docs/SPEC.md` — what the card says, exact copy, formulas, variants
2. `docs/ARCHITECTURE.md` — stack, routes, data flow, tokens, caching, fallbacks
3. `docs/API_UPSTOX.md` and `docs/API_ALPACA.md` — verified endpoints and fields
4. `docs/UI_REFERENCE.md` + `reference/add-more-check-demo.html` — the pixel reference
5. `docs/PHASES.md` — the order of work and the acceptance gate for each phase
6. `PROGRESS.md` and `HUMAN_TODO.md` — current state; update both as you go

## Non-negotiable rules

1. **Real data only.** Every number rendered comes from an API response (live) or from a JSON file
   under `data/cache/` that was itself written by an API call (with `fetched_at`). No placeholder
   prices, no sample holdings, no persona accounts, no `MOCK_*` constants anywhere in `src/`.
   If a data source is unavailable, render a labelled "unavailable / awaiting" state. Never invent.
2. **The reference HTML is the UI spec.** `reference/add-more-check-demo.html` is the finalized
   look. Match its layout, spacing, colours, typography, copy and behaviour. Where the reference
   has hardcoded data, the real build reads the same shape from the API. Do not redesign.
3. **Scope is locked.** Build exactly what `docs/SPEC.md` lists. Do not add rows, charts,
   portfolio-concentration lines, charges-inclusive averages, "last traded at" lines, or any
   recommendation. Do not remove "A 10% move is worth".
4. **Fact-only copy.** No "avoid", "don't", "should", "risky", "safe", "opportunity", "recover",
   "target". No red/green judgement colouring on the card. Never block an order.
5. **Tokens stay server-side.** Upstox and Alpaca keys/tokens are read only in server code
   (`src/server/*`, route handlers). The browser receives data, never tokens.
6. **Order placement is optional and isolated.** `ENABLE_SANDBOX_ORDER=true` → POST to the
   Upstox **sandbox** host. Any failure, or the flag off → identical confirmation sheet without
   an order ID, labelled "order placement not wired in this demo". Nothing else may depend on it.
7. **Never fabricate verification.** A phase is done only when its acceptance criteria in
   `docs/PHASES.md` are met and a screenshot exists in `artifacts/screenshots/`.

## Working protocol

- **PROGRESS.md** is the single source of truth for status. Before starting a task, mark it
  `[~]`; when done, `[x]` with a one-line note and the screenshot filename. Keep "Done / In
  progress / Left" sections accurate. Append a dated entry to the Build log at every phase gate.
- **HUMAN_TODO.md** is where you put anything only the human can do (an expired OAuth token, an
  OTP, a missing key, an unresolved instrument key, Alpaca fills not yet landed). Write the exact
  steps, mark the dependent task `(blocked:human)` in PROGRESS.md, and **continue with every
  task that does not depend on it**. Do not wait. Do not simulate the missing data.
- **Review gates.** At the end of each phase: (1) take screenshots with the Playwright MCP
  (`docs/UI_REFERENCE.md` lists the exact states and viewport), (2) invoke the `qa-visual`,
  `cpo`, `spm` and `cto` subagents in that order with the phase number and screenshot paths,
  (3) fix every BLOCK they raise before moving on, (4) record their verdicts in PROGRESS.md.
  The `cpo` agent has the final say on product questions; the `cto` agent on technical ones.
- **Verify against the real API, not against your own code.** When a value looks wrong, fetch
  the raw endpoint and compare. Holdings `average_price` from Upstox is the truth for "You hold".
- **Market closed is normal.** On weekends/after hours LTP v3 returns the last close and the
  WebSocket sends no ticks. Show "Last traded <day> 15:30" and keep everything working.
- **Commit after every phase** (`git add -A && git commit -m "phase N: ..."`).
- Keep going until every task in PROGRESS.md is `[x]` or `(blocked:human)`, then write
  `BUILD_REPORT.md` and create the file `.build-complete`. The Stop hook will not let you stop
  before that.

## Stack (fixed)

Next.js 14 (App Router) + TypeScript + Tailwind for layout utilities, plain CSS for the Upstox
replica (port the reference stylesheet); `vitest` for the compute engine; `ws` + `protobufjs` for
the Upstox feed (server-side), SSE to the browser; no database. Node 20+. Everything lives in
this folder (the kit is the repo root). `npm run dev` on port 3000.

## Agents available

`qa-visual` (screenshots + reference diff), `cpo` (product/scope/copy), `spm` (clarity/UI
fidelity), `cto` (real-API + code review). Definitions in `.claude/agents/`.
