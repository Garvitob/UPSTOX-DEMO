# PHASES — do them in order; each ends with a review gate

Review gate = screenshots per `docs/UI_REFERENCE.md` → `qa-visual` → `cpo` → `spm` → `cto` → fix BLOCKs →
PROGRESS.md updated → git commit. A phase with a `(blocked:human)` item still passes its gate for
everything not blocked.

## Phase 0 — Preflight (no app code yet)
- Read all docs. Run `node scripts/check-env.mjs` and record which keys/tokens are present.
- Run `node scripts/resolve-instruments.mjs`; confirm `data/instruments.json` has a key for every
  holding ISIN and (ideally) the USD INR global key. If USD INR missing: try the WebFetch route in
  `docs/API_UPSTOX.md`; if still missing → HUMAN_TODO.
- Confirm `data/cache/holdings.json` and `trades.json` exist and list the symbols found. If missing
  and the OAuth token is valid, run `node scripts/fetch-upstox-cache.mjs`. If the token is dead →
  HUMAN_TODO (login script) and continue.
- Hit LTP v3 for one holding with the Analytics token; record the price in PROGRESS.md.
- Hit Alpaca `/v2/positions` and `/v2/orders?status=all`; record whether fills exist.
Accept: PROGRESS.md "Preflight" section filled with real values; HUMAN_TODO.md lists anything missing.

## Phase 1 — Scaffold + compute engine
- `npx create-next-app@14` (TS, App Router, Tailwind, src dir, no ESLint prompts), `vitest`, `ws`, `protobufjs`.
- `src/lib/compute.ts`, `format.ts`, `copy.ts` implementing SPEC formulas and strings.
- `tests/compute.test.ts`: at least these cases — PAYTM example (6@2150, buy 3@1656 → 1985.33, gaps
  29.8%/19.9%, moves 994/1490), averaging up, T1 inclusion, GTT ref, US example (2.4@182.10, fills at
  fx 82.6/83.4, fxNow 88, buy 1@176 → $180.31 / ₹15,223, returns −3.3% / +2.5%), nth() ordinals.
Accept: `npm test` green; `npm run build` green.

## Phase 2 — Upstox data layer
- `server/env.ts`, `upstox.ts`, `cache.ts`, `instruments.ts`; routes `/api/holdings`, `/api/trades`,
  `/api/ltp`, `/api/instruments`, `/api/fx` (live + ?date=).
- Integration check script `scripts/smoke-api.mjs` (calls each route on the running dev server and
  prints the real values). Paste the output into PROGRESS.md.
Accept: every route returns real data or a labelled `source:"cache"` / `error:"missing_env"`; no
mock branches; `cto` confirms tokens never reach the client bundle (grep the `.next` client chunks).

## Phase 3 — Shell replica
- Port the reference layout and CSS; holdings table + summary + watchlist from real data; ticker from
  index LTPs; source chips.
Accept: `p3-shell.png` matches the reference layout (qa-visual PASS); no horizontal scroll.

## Phase 4 — The card (Regular tab)
- `AddMoreCard` with header/lead/rows/chain/footer per SPEC; shown only when held; live
  recalculation on quantity, Market/Limit toggle and limit price; hidden for never-held symbols.
Accept: `p4-*.png`; `cpo` PASS on copy rules and scope; `spm` PASS on readability; numbers verified
by `cto` against a hand calculation from the raw holdings JSON.

## Phase 5 — GTT, MTF, re-entry
- GTT tab: trigger input drives `ref` and `p`; copy per SPEC. MTF tab variant. Re-entry card for
  sold-out ISINs found in trade history (if none exist in the real history, implement + unit-test
  and note "no sold-out symbol in this account" in PROGRESS.md; do not fabricate one).
Accept: `p5-*.png`; gates PASS.

## Phase 6 — Live price
- `upstoxFeed.ts` + `/api/stream` + `useLivePrice`; polling fallback; market-closed state.
Accept: with the market closed, chip shows `Last traded …` and values equal LTP v3; the SSE route
stays connected ≥ 60 s without errors; `cto` reviews reconnect/backoff.

## Phase 7 — US tab
- Alpaca routes, FX routes, US card per SPEC, holdings table US view, India/US switch.
- If no Alpaca fill yet: `Awaiting first fill` state, and a note in HUMAN_TODO to re-run after fills.
Accept: `p7-us-card.png` (or the awaiting state screenshot, clearly named); FX chip shows the real
Upstox key used; `cpo` PASS on the lead sentence and the "why they differ" line.

## Phase 8 — Order flow
- Confirm sheet; `POST /api/order` with `ENABLE_SANDBOX_ORDER` flag → sandbox host; any failure →
  fallback sheet; local position update labelled.
Accept: `p8-confirm.png` in both modes (flag on and off); the app behaves identically with the flag
off; `cto` confirms nothing else imports the order module.

## Phase 9 — Polish + phone + docs
- Loading/error/unavailable states; phone layout; `README.md` for the repo (how to run, env, what is
  real); `artifacts/API_MAP.md` (card row → endpoint → fields) for the PDF; final screenshot set.
Accept: all screenshots present; `npm run build` green; `npm test` green; gates PASS.

## Phase 10 — Close out
- PROGRESS.md: everything `[x]` or `(blocked:human)`; `BUILD_REPORT.md` (what was built, what is
  live vs cached, what is blocked and why, how to demo); create `.build-complete`.
