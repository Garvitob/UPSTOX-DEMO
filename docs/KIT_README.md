# Add-More Check — Claude Code build kit

One feature, built autonomously by Claude Code on the **real Upstox Developer API** (holdings, trade
history, LTP v3, WebSocket feed, candles, sandbox orders) with a US extension on the **real Alpaca paper
API** + Upstox's live USD/INR. UI replicates Upstox Pro and the finalized demo in `reference/`.

Start here: **SETUP.md** (what you do, ~40 minutes) → paste **START_PROMPT.md** into Claude Code → sleep.

```
CLAUDE.md                 rules the agent follows on every turn
START_PROMPT.md           the prompt you paste into Claude Code
SETUP.md                  your setup steps (keys, tokens, cache, Alpaca seed, launch)
PROGRESS.md               live status: done / in progress / left (the Stop hook reads this)
HUMAN_TODO.md             things the agent needs from you; it keeps building around them
docs/SPEC.md              exact card copy, formulas, variants, edge cases
docs/ARCHITECTURE.md      stack, routes, data flow, cache rule, streaming, flags
docs/API_UPSTOX.md        verified endpoints, hosts, tokens, fields
docs/API_ALPACA.md        paper endpoints
docs/UI_REFERENCE.md      how to replicate the UI; screenshot protocol for QA
docs/PHASES.md            10 phases with acceptance gates
docs/DEMO_RUNBOOK.md      Monday morning + 4-minute demo order
reference/                finalized hardcoded demo (pixel reference) + your Upstox screenshots
scripts/                  check-env, upstox-login, fetch-upstox-cache, resolve-instruments, alpaca-seed-orders, smoke-api
.claude/agents/           cpo, spm, cto, qa-visual subagents (review gates)
.claude/settings.json     permissions + Stop hook (keeps the agent working until done)
.claude/hooks/            stop-gate.mjs
.mcp.json                 Playwright MCP (screenshots)
.env.example              copy to .env.local and fill
```
After the build: `BUILD_REPORT.md`, `artifacts/screenshots/*.png`, `artifacts/API_MAP.md`.
