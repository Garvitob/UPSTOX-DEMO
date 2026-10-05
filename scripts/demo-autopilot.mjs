// Demo autopilot: drives the REAL app (real Upstox Developer API + real Alpaca paper data) through docs/DEMO_RUNBOOK.md
// with human-paced pauses, so you can screen-record and narrate while it clicks. Nothing is injected into the page —
// every pixel is the real app. For each step the console prints the line to say, filled in with the values read off the
// page at that moment (this script contains no prices, averages or balances of its own).
//
//   node scripts/demo-autopilot.mjs                       headed (default): a maximized window to narrate over, :3000
//   node scripts/demo-autopilot.mjs --pace 4              the same, with more room to talk
//   node scripts/demo-autopilot.mjs --headless --video    silent backup → artifacts/video/demo-<timestamp>.webm (1920×1080)
//   node scripts/demo-autopilot.mjs --base http://127.0.0.1:3002 --pace 1   quick rehearsal on the sandbox-OFF server
//
//   --base <url>   the app to drive (default http://127.0.0.1:3000)
//   --pace <s>     seconds per step (default 3); a step with a longer line to say stays up long enough to say it
//                  (pace 3 ≈ 150 words a minute; a full run takes about 4 minutes)
//   --video        also record a 1920×1080 .webm of the run into artifacts/video/
//   --headless     no window (pair it with --video for the backup recording)
//   --sell-order   ONLY with the :3000 server (sandbox orders ON): clicks "Review sell order" ONCE → one real Upstox
//                  SANDBOX sell, then the sheet's Done. Without it the run stops before Review and never clicks it.
//
// Safety: every POST /api/order is aborted inside the browser (Playwright request routing on the browser context, so it
// covers every page) unless --sell-order, and then only that one SELL.
// Review buy order, Add funds and Done are never clicked (Done only on the sell sheet). Ctrl+C stops; a video is still saved.
// playwright-core is found exactly like scripts/check-overflow.mjs (the Playwright MCP's npx cache, or PLAYWRIGHT_CORE).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_DIR = path.join(ROOT, 'artifacts', 'video');
const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };
const PHONE_MS = 5000;
// Inputs that drive the runbook's flow (not data): a holding at a loss, a holding in profit, a watchlist stock that is
// not held, the quantity typed in step 5 and the GTT % typed in step 8.
const LOSS = 'PAYTM';
const PROFIT = 'TMCV';
const UNHELD = 'VEDL';
const DEMO_QTY = '3';
const GTT_PCT = '0.50';
const WORDS_PER_PACE = 7.5; // at the default pace 3: 2.5 words per second (~150 words a minute), a natural narration speed

// ------------------------------------------------------------------ flags
const USAGE = 'Usage: node scripts/demo-autopilot.mjs [--base <url>] [--pace <seconds>] [--video] [--headless] [--sell-order]';
const o = { base: 'http://127.0.0.1:3000', pace: 3, video: false, headless: false, sellOrder: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.indexOf('=');
  const name = eq > 0 ? a.slice(0, eq) : a;
  const val = () => (eq > 0 ? a.slice(eq + 1) : argv[++i]);
  if (name === '--base') o.base = val();
  else if (name === '--pace') o.pace = Number(val());
  else if (name === '--video') o.video = true;
  else if (name === '--headless') o.headless = true;
  else if (name === '--sell-order') o.sellOrder = true;
  else if (name === '--help' || name === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`Unknown argument "${a}".\n${USAGE}`);
    process.exit(2);
  }
}
if (!(Number.isFinite(o.pace) && o.pace > 0 && o.pace <= 60)) {
  console.error(`--pace takes seconds between 0 and 60 (got "${o.pace}").`);
  process.exit(2);
}
let BASE;
try {
  BASE = new URL(o.base ?? '');
} catch {
  console.error(`--base is not a URL: "${o.base}".`);
  process.exit(2);
}

// ------------------------------------------------------------------ console
const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const COLS = Math.min(Math.max((process.stdout.columns || 112) - 1, 72), 120);
function out(tag, msg, code) {
  const width = COLS - 13;
  const lines = [];
  let cur = '';
  for (const w of String(msg).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  lines.forEach((l, i) => console.log(`       ${i ? '      ' : `${paint(code, tag.padEnd(5))} `}${tag === 'SAY' ? paint('1', l) : l}`));
}
const see = m => out('SEE', m, '2'); // values on screen right now (read from the page)
const look = m => out('LOOK', m, '35'); // what to talk about on screen (no need to move the mouse)
const act = m => out('DO', m, '35'); // something the presenter does
const note = m => out('NOTE', m, '33');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const words = s => (String(s).match(/\S+/g) || []).length;
const beat = (m = 0.5) => sleep(1000 * o.pace * m);
/** Prints the line to say, then holds the screen long enough to say it (pace × max(weight, words / WORDS_PER_PACE)). */
async function speak(line, weight = 1) {
  const secs = o.pace * Math.max(weight, words(line) / WORDS_PER_PACE);
  out('SAY', line, '1;36');
  console.log(`       ${paint('2', `      (on screen ~${Math.round(secs)} s)`)}`);
  await sleep(secs * 1000);
}
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const typeDelay = Math.round(60 * o.pace); // ms per key, so typing reads as typing

// ------------------------------------------------------------------ preflight: is the app up, which flags are on
let flags;
try {
  const r = await fetch(new URL('/api/order', BASE), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  flags = await r.json();
} catch (e) {
  console.error(`The app is not answering at ${BASE.origin} (${e.cause?.code ?? e.message}). Start it with: npm run dev`);
  process.exit(1);
}
const sandboxServer = BASE.port === '3000' && ['127.0.0.1', 'localhost'].includes(BASE.hostname);
const SELL = o.sellOrder && sandboxServer && flags?.sandbox_order === true;

// ------------------------------------------------------------------ playwright-core (same lookup as check-overflow.mjs)
// Finds a playwright-core install (the Playwright MCP's npx cache) unless PLAYWRIGHT_CORE points at its package.json.
function findPlaywrightCore() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const p = path.join(root, d, 'node_modules', 'playwright-core', 'package.json');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('playwright-core not found: run npx @playwright/mcp once, or set PLAYWRIGHT_CORE');
}
const require = createRequire(process.env.PLAYWRIGHT_CORE || findPlaywrightCore());
const { chromium } = require('playwright-core');

const d0 = new Date();
const p2 = n => String(n).padStart(2, '0');
const stamp = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}_${p2(d0.getHours())}-${p2(d0.getMinutes())}-${p2(d0.getSeconds())}`;
// Headless or recording: a fixed 1920×1080 page (the screenshots' size). Headed alone: a real maximized window.
const FIXED = o.headless || o.video;
if (o.video) fs.mkdirSync(VIDEO_DIR, { recursive: true });

console.log(paint('1', '\nAdd-More Check · demo autopilot'));
console.log(`  app     ${BASE.origin} · sandbox order placement ${flags?.sandbox_order ? 'ON' : 'OFF'} on this server (GET /api/order)`);
console.log(`  run     ${o.headless ? 'headless' : FIXED ? 'headed, 1920×1080 page' : 'headed, maximized window'} · pace ${o.pace} s · video ${o.video ? `→ artifacts/video/demo-${stamp}.webm` : 'off'}`);
console.log(`  orders  ${SELL ? `ONE real Upstox SANDBOX sell at the ${LOSS} Sell step (--sell-order); every other POST /api/order is blocked` : 'every POST /api/order is blocked in the browser; Review is never clicked'}`);
if (o.sellOrder && !SELL)
  note(`--sell-order ignored: it only works against the :3000 server with sandbox orders ON (this is ${BASE.origin}, sandbox ${flags?.sandbox_order ? 'ON' : 'OFF'}).`);
if (!o.headless) console.log('  tip     keep the mouse off the browser window while it runs · Ctrl+C stops');

const browser = await chromium.launch({
  headless: o.headless,
  handleSIGINT: false, // Ctrl+C goes to finish() below, which closes the context first so the video is written
  // Headed: a plain Chrome window without the "controlled by automated test software" bar — the same switches
  // Playwright's own app launcher uses (no --enable-automation; --test-type= keeps the --no-sandbox warning away).
  args: o.headless ? [] : [...(FIXED ? [] : ['--start-maximized']), '--test-type='],
  ignoreDefaultArgs: o.headless ? [] : ['--enable-automation'],
});
const context = await browser.newContext({
  viewport: FIXED ? DESKTOP : null,
  ...(o.video ? { recordVideo: { dir: VIDEO_DIR, size: DESKTOP } } : {}),
});
const videoStart = Date.now();

// Order safety net: the only mutating route is POST /api/order. Abort it unless --sell-order armed the one SELL.
let sellArmed = false;
let sellsSent = 0;
const blocked = [];
await context.route(
  u => u.pathname === '/api/order',
  async route => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    if (SELL && sellArmed && sellsSent === 0 && body?.side === 'SELL') {
      sellsSent++;
      sellArmed = false;
      return route.continue();
    }
    blocked.push(norm(`${req.method()} /api/order ${body?.side ?? ''} ${body?.symbol ?? ''}`));
    console.log(paint('33', `       BLOCKED ${blocked.at(-1)}`));
    return route.abort('blockedbyclient');
  },
);

const page = await context.newPage();
page.setDefaultTimeout(20000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.dismiss().catch(() => {}));
let cdp = null; // headed (maximized window) only: maximize + the phone-width device emulation
if (!FIXED) {
  try {
    cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch (e) {
    note(`Could not maximize the window (${e.message}); maximize it by hand.`);
  }
}

// ------------------------------------------------------------------ page helpers (read-only DOM reads + real clicks)
const order = page.locator('section.order');
const text = async loc => {
  const l = loc.first();
  return (await l.count()) ? norm(await l.textContent({ timeout: 3000 }).catch(() => '')) : '';
};
/** What a viewer sees in an element: line breaks as " · ", hidden parts (e.g. un-hovered row buttons) left out. */
const shown = async loc => {
  const l = loc.first();
  return (await l.count()) ? (await l.innerText({ timeout: 3000 }).catch(() => '')).split('\n').map(norm).filter(Boolean).join(' · ') : '';
};
async function until(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for ${what}`);
}
// The autopilot never clicks an order button: Review buy order, Add funds and Done are refused here. The only
// exceptions are the one Review sell order (and the sheet's Done after it) with --sell-order on :3000.
const GUARDED = 'button.review, button.addfunds, .sheet button.ok';
async function safeClick(loc, what, allow = null) {
  const l = loc.first();
  await l.waitFor({ state: 'visible', timeout: 20000 });
  const kind = await l.evaluate(
    (el, sel) => (el.closest(sel) ? (el.matches('button.review.sell') ? 'sell-review' : el.matches('.sheet button.ok') ? 'sell-done' : 'order') : null),
    GUARDED,
  );
  if (kind && !(SELL && allow === kind)) throw new Error(`refused to click ${what}: order buttons are off-limits for the autopilot`);
  await l.click();
}
async function readCard() {
  const c = order.locator('.amc').first();
  if (!(await c.count())) return null;
  return c.evaluate(el => {
    const t = s => (el.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const rows = {};
    for (const r of el.querySelectorAll('.kv')) {
      const g = s => (r.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      rows[g('.k')] = { v: g('.v'), s: g('.s') };
    }
    return { variant: el.dataset.variant ?? '', open: el.classList.contains('open'), title: t('.ttl'), sum: t('.sum'), lead: t('.lead'), chain: t('.chain'), foot: t('.foot').replace(/^i\s*/, ''), rows };
  });
}
async function readTicket() {
  return order.evaluate(el => {
    const t = s => (el.querySelector(s)?.textContent ?? '').replace(/[⟳]/g, '').replace(/\s+/g, ' ').trim();
    const btn = el.querySelector('button.review');
    return {
      name: t('.o-stock .nm'),
      px: (el.querySelector('.o-stock .px')?.innerText ?? '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · '),
      ltt: t('.o-stock .ltt'),
      req: t('.o-foot .req'),
      reqNote: el.querySelector('.o-foot .req')?.getAttribute('title') ?? '',
      avail: t('.o-foot .avail'),
      mtf: t('.o-foot .mtf'),
      cta: btn ? btn.textContent.trim() : '',
      ctaOn: btn ? !btn.disabled : false,
      fundsMsg: t('.funds-msg'),
      mtfRow: t('.mtfrow'),
      note: t('.amc-note'),
      chips: [...el.querySelectorAll('.chips .chip')].map(c => ({ text: c.textContent.replace(/\s+/g, ' ').trim(), state: [...c.classList].find(x => x !== 'chip') ?? '' })),
    };
  });
}
/** The footer once Upstox has answered for this exact order: Required (Margin API) and the button's state. */
async function settledTicket(timeout = 20000) {
  return until(
    async () => {
      const f = await readTicket();
      return f.ctaOn && (!/—/.test(f.req) || f.reqNote) ? f : null;
    },
    'Required (Upstox Margin API) and the order button',
    timeout,
  ).catch(() => readTicket());
}
const valueOf = s => norm(String(s).replace(/^[^:]*:\s*/, ''));
const chipsLine = f => f.chips.map(c => c.text).join(' · ');
async function waitTicket(sym) {
  await until(async () => (await order.isVisible()) && (await text(order.locator('.o-stock .nm'))) === sym, `the ${sym} ticket`, 20000);
}
async function waitCard(timeout = 30000) {
  try {
    await until(async () => order.locator('.amc .head').isVisible(), 'the Add-More card', timeout);
  } catch (e) {
    const n = await text(order.locator('.amc-note'));
    throw new Error(n ? `no card; the ticket says "${n}"` : e.message);
  }
}
async function expandCard() {
  if (!(await order.locator('.amc.open').count())) await safeClick(order.locator('.amc .head'), 'the card header');
  await order.locator('.amc.open .body').waitFor({ state: 'visible', timeout: 5000 });
}
async function closeExchangeDialog() {
  if (await page.locator('.xm').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.locator('.xm').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
}
const readExchangeOptions = () =>
  page.locator('.xm-opt').evaluateAll(els =>
    els.map(el => ({ ex: el.dataset.ex, px: (el.querySelector('.px > span')?.textContent ?? '').trim(), ch: (el.querySelector('.px small')?.textContent ?? '').trim() })),
  );
/** Upstox Pro's flow: hover the row → Buy / Sell (or the watchlist's B) → "Exchange to … From" → NSE → the ticket. */
async function openFromRow(row, button, sym, verb) {
  await closeExchangeDialog();
  await row.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    throw new Error(`no ${sym} row on the page`);
  });
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const btn = row.locator(button);
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await beat();
  await row.hover(); // hover again right before the click: the buttons only exist while the row is hovered
  await safeClick(btn, `${verb} ${sym}`);
  // a stock listed on NSE and BSE asks for the exchange; a single-exchange stock opens the ticket directly
  if (await page.locator('.xm').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
    await beat(0.6);
    await safeClick(page.locator('.xm-opt[data-ex="NSE"]'), 'NSE in the exchange dialog');
    await page.locator('.xm').waitFor({ state: 'detached', timeout: 5000 });
  }
  await waitTicket(sym);
}
/** Phone width: a fixed page is resized; a maximized headed window gets DevTools-style device emulation (cleared after). */
async function phoneWidth(on) {
  if (FIXED) return page.setViewportSize(on ? PHONE : DESKTOP);
  if (!cdp) cdp = await context.newCDPSession(page);
  if (on) await cdp.send('Emulation.setDeviceMetricsOverride', { width: PHONE.width, height: PHONE.height, deviceScaleFactor: 0, mobile: false });
  else await cdp.send('Emulation.clearDeviceMetricsOverride');
}

// ------------------------------------------------------------------ the demo (docs/DEMO_RUNBOOK.md, "The 5-minute demo")
const steps = [];
const step = (title, run) => steps.push({ title, run });
const carry = {}; // values read on one step and spoken on a later one

step('Holdings page', async () => {
  const holdingsResp = page
    .waitForResponse(r => new URL(r.url()).pathname === '/api/holdings', { timeout: 60000 })
    .then(r => r.json())
    .catch(() => null);
  await page.goto(BASE.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator(`tbody tr[data-sym="${LOSS}"]`).waitFor({ state: 'visible', timeout: 60000 });
  // the summary strip fills in once every holding has its price (LTP v3 / feed)
  if (!(await page.locator('.summary .cv').waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false)))
    note('Prices are still loading: the holdings summary has not filled in yet.');
  const h = await holdingsResp;
  if (h) see(`/api/holdings: ${h.source}${h.fetched_at ? `, fetched ${new Date(h.fetched_at).toLocaleTimeString('en-GB')}` : ''}`);
  const banner = await text(page.locator('.banner'));
  look('The ticker, the P&L and the holdings. No order panel is open, exactly like Upstox Pro.');
  if (banner) note(`Banner on screen: "${banner}" Say so out loud (runbook: If something is down).`);
  await speak(
    h?.source === 'cache'
      ? 'This is Upstox Pro with one addition. Every number on this page comes from the Upstox Developer API on a real family account: prices live, holdings from the labelled snapshot the banner names. Nothing is typed in.'
      : 'This is Upstox Pro with one addition. Every number on this page is live from the Upstox Developer API on a real family account. Nothing is typed in.',
    1.2,
  );
});

step(`Hover ${LOSS} → Buy → "Exchange to Buy From"`, async () => {
  const row = page.locator(`tbody tr[data-sym="${LOSS}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator('.row-act .b').waitFor({ state: 'visible', timeout: 5000 });
  look(`Hovering ${LOSS} shows Buy / Sell / ⋮.`);
  await beat(1.2);
  await row.hover();
  await safeClick(row.locator('.row-act .b'), `Buy ${LOSS}`);
  await page.locator('.xm').waitFor({ state: 'visible', timeout: 5000 });
  const opts = await until(async () => {
    const v = await readExchangeOptions();
    return v.length && v.every(x => x.px && x.px !== '—') ? v : null;
  }, 'the prices in the exchange dialog').catch(() => readExchangeOptions());
  await speak(
    `Same flow as Upstox: hover, Buy, and it asks which exchange. ${opts.length > 1 ? 'Both prices come' : 'The price comes'} straight from Upstox: ${opts.map(x => `${x.ex} ${x.px}${x.ch ? ` ${x.ch}` : ''}`).join(', ')}, each with its own day change.`,
  );
});

step('NSE → Place Order panel, card collapsed', async () => {
  await safeClick(page.locator('.xm-opt[data-ex="NSE"]'), 'NSE in the exchange dialog');
  await page.locator('.xm').waitFor({ state: 'detached', timeout: 5000 });
  await waitTicket(LOSS);
  await waitCard();
  const c = await readCard();
  const f = await readTicket();
  see(`card: ${c.title} · ${c.sum}`);
  see(`chips: ${chipsLine(f)}${f.ltt ? ` · under the prices: ${f.ltt}` : ''}`);
  look(`"${c.sum}" in the card's header, and the chips above the footer.`);
  await speak(
    `${/lowers your average/.test(c.lead) ? 'Someone adding to a losing position' : 'Someone adding to a position'} sees one line: what this order does to their average, "${c.sum}". The chips say where each number came from, right now.`,
    1.2,
  );
});

step('Required · Available (Upstox Margin API · Funds API)', async () => {
  const f = await settledTicket();
  const fundsChip = f.chips.find(c => /funds/i.test(c.text));
  see(`footer: ${f.req} · ${f.avail || f.mtf} · [${f.cta}]${f.fundsMsg ? ` · "${f.fundsMsg}"` : ''}`);
  if (f.reqNote) see(`Required on hover: ${f.reqNote}`);
  const req = valueOf(f.req);
  const reqLine = /—/.test(req)
    ? 'Required shows "—": the Upstox Margin API did not answer for this order, so nothing is estimated.'
    : `Required, ${req}, is the Margin API's real requirement for this exact order.`;
  if (/Add funds/i.test(f.cta)) {
    look(`The red line, "${f.avail}" and Add funds (the autopilot never clicks it).`);
    await speak(
      `That's this account's real balance from the Upstox Funds API, ${valueOf(f.avail)}, and the Margin API's real requirement, ${req}. Upstox shows exactly this. The card still tells you what the order would do before you fund it.`,
    );
  } else if (fundsChip) {
    look(`The chip "${fundsChip.text}" and Available.`);
    await speak(
      `${/closed/i.test(fundsChip.text) ? "Upstox's Funds service is closed right now" : "Upstox's Funds API did not answer just now"}, and the chip says so: "${fundsChip.text}". Available shows "—" and the button stays ${f.cta}. ${reqLine}`,
    );
  } else {
    look('Required and Available in the footer.');
    await speak(`${reqLine} Available, ${valueOf(f.avail)}, is this account's real balance from the Upstox Funds API. Upstox shows exactly this.`);
  }
});

step('Expand the card', async () => {
  await expandCard();
  const c = await readCard();
  see(`rows: ${Object.entries(c.rows).map(([k, r]) => `${k} ${r.v}`).join(' · ')}`);
  await speak("Expanded, it answers five questions in ten seconds: shares, new average, break-even vs today's price, what a 10% move is worth in rupees, and buy history.", 1.5);
});

step(`Quantity ${DEMO_QTY}: live recompute`, async () => {
  const before = (await readCard()).sum;
  const box = order.locator('input[aria-label="Quantity"]');
  await box.click();
  await box.press('Control+A');
  await box.pressSequentially(DEMO_QTY, { delay: typeDelay });
  const c = await until(async () => {
    const x = await readCard();
    return x && x.sum && x.sum !== before ? x : null;
  }, 'the card to recompute');
  const avg = c.rows['Average price'];
  const move = c.rows['A 10% move is worth'];
  see(`header: ${c.sum}${avg?.s ? ` · ${avg.s}` : ''}${move ? ` · 10% move ${move.v}` : ''}`);
  await speak(`At ${DEMO_QTY} shares it's ${c.sum.split('→').pop().trim()}. It recalculates as you type. Facts only, never "buy" or "don't".`);
});

step('Buy history line', async () => {
  await order.locator('.amc .chain').scrollIntoViewIfNeeded().catch(() => {});
  const c = await readCard();
  if (!c.chain) throw new Error('the card shows no buy-history line');
  const avg = c.sum.split('→')[0].replace(/^Avg\s*/, '').trim();
  look('The buy-history line at the bottom of the card.');
  await speak(
    /^No buys/.test(c.chain)
      ? `That line is real: "${c.chain}" The average is exactly ${avg}, ${LOSS}'s IPO price, and Upstox's trade-history window has no ${LOSS} trades. The card says so instead of inventing a history.`
      : /unavailable/i.test(c.chain)
        ? `Upstox Trade History did not answer just now, so the card says so: "${c.chain}" It never invents a history.`
        : `That line is real: "${c.chain}", straight from Upstox Trade History.`,
  );
});

step('BSE radio', async () => {
  const bse = order.locator('.exr[data-ex="BSE"]');
  if (!(await bse.count())) throw new Error(`the ${LOSS} ticket shows no BSE price`);
  await safeClick(bse, 'the BSE radio');
  await order.locator('.exr[data-ex="BSE"][aria-pressed="true"]').waitFor({ timeout: 5000 });
  const f = await until(async () => {
    const x = await readTicket();
    return x.chips.some(c => /\bBSE\b/.test(c.text)) ? x : null;
  }, 'the price chip to name BSE');
  const chip = f.chips.find(c => /\bBSE\b/.test(c.text));
  const c = await readCard();
  see(`card: ${c.sum} · footer: ${c.foot}`);
  await speak(
    `Switch exchange and the price, the requirement and the card follow BSE's ${chip.state === 'live' ? 'live quote' : 'last traded price'}: "${c.sum}". The chip and the card's footer now say BSE, from BSE's own market status: "${chip.text}".`,
  );
});

step('Back to NSE', async () => {
  await safeClick(order.locator('.exr[data-ex="NSE"]'), 'the NSE radio');
  await order.locator('.exr[data-ex="NSE"][aria-pressed="true"]').waitFor({ timeout: 5000 });
  await until(async () => (await readTicket()).chips.some(c => /\bNSE\b/.test(c.text)), 'the price chip to name NSE');
  await speak('And back to NSE.', 0.8);
});

step(`GTT tab, ${GTT_PCT} % in the % box`, async () => {
  await safeClick(order.locator('.o-tabs button[data-tab="gtt"]'), 'the GTT tab');
  await order.locator('.o-tabs button[data-tab="gtt"].on').waitFor({ timeout: 5000 });
  const trig = order.locator('input[aria-label="Trigger price"]');
  const pct = order.locator('input[aria-label="Trigger distance in percent"]');
  const t0 = await until(async () => trig.inputValue(), 'the default GTT trigger');
  const p0 = await pct.inputValue();
  const c0 = await readCard();
  see(`default: ₹ ${t0} ⇄ ${p0} % · card: ${c0?.title} · ${c0?.sum}`);
  await beat(1);
  await pct.click();
  await pct.press('Control+A');
  await pct.pressSequentially(GTT_PCT, { delay: typeDelay });
  const t1 = await until(async () => {
    const v = await trig.inputValue();
    return v && v !== t0 ? v : null;
  }, 'the trigger to move');
  const c = await readCard();
  const f = await settledTicket();
  // "Buy for ₹…/share with MTF …X" (Margin API, re-asked after the exchange switch) shows on Regular and GTT, not on MTF
  carry.mtfRow = await until(async () => {
    const r = (await readTicket()).mtfRow;
    return /\/share/.test(r) ? r : null;
  }, 'the MTF row figure', 5000).catch(() => '');
  see(`trigger ₹ ${t1} · card: ${c.sum} · footer: ${[f.req, f.mtf, f.cta].filter(Boolean).join(' · ')}`);
  const reqSaid = /—/.test(valueOf(f.req)) ? 'Required "—" until the Margin API answers' : f.req;
  await speak(
    `For GTT the reference price is the trigger, so the card reads "${c.title}". Upstox's default is ${p0} % under the live price: ₹ ${t0}. Type a percentage and the trigger moves on the tick grid, ${GTT_PCT} % gives ₹ ${t1}, and the card follows. The footer is Upstox's own: ${[reqSaid, f.mtf, f.cta].filter(Boolean).join(', ')}.`,
    1.5,
  );
});

step('MTF tab', async () => {
  await safeClick(order.locator('.o-tabs button[data-tab="mtf"]'), 'the MTF tab');
  await order.locator('.o-tabs button[data-tab="mtf"].on').waitFor({ timeout: 5000 });
  await order.locator('.amc[data-variant="mtf"]').waitFor({ timeout: 15000 });
  await expandCard();
  const c = await readCard();
  const badge = await text(order.locator('.o-tabs button[data-tab="mtf"] .badge'));
  const perShare = /₹\s?[\d,]+(?:\.\d+)?\/share/.exec(carry.mtfRow ?? '')?.[0];
  see(`card: ${c.lead}`);
  await speak(
    'MTF lots are funded separately and leave the delivery average unchanged.' +
      (perShare && badge ? ` ${perShare} and ${badge} come live from Upstox's margin API.` : badge ? ` ${badge} comes live from Upstox's margin API.` : ''),
  );
});

step('Close the panel (✕)', async () => {
  await safeClick(order.locator('.o-head .x'), 'the panel ✕');
  await page.locator('section.order.closed').waitFor({ state: 'attached', timeout: 5000 });
  look('The panel closes.');
  await beat(1);
});

step(`${PROFIT} → Buy → NSE → expand (averaging up)`, async () => {
  await openFromRow(page.locator(`tbody tr[data-sym="${PROFIT}"]`), '.row-act .b', PROFIT, 'Buy');
  await waitCard();
  await beat();
  await expandCard();
  const c = await readCard();
  const dir = /(?:lowers|raises|keeps) your average (?:to|at) ₹[\d,]+(?:\.\d+)?/.exec(c.lead)?.[0] ?? c.sum;
  const be = c.rows['Average price']?.s ?? '';
  see(`card: ${c.sum}`);
  await speak(/^raises/.test(dir) ? `In profit, the wording flips on its own: "${dir}", and "${be}".` : `Here the card reads: "${dir}", and "${be}".`, 1.2);
});

step(`Watchlist ${UNHELD} → B → NSE (not held: no card)`, async () => {
  const tradesAnswered = page.waitForResponse(r => r.url().includes('/api/trades?isin='), { timeout: 10000 }).catch(() => null);
  await openFromRow(page.locator(`.wl .row[data-sym="${UNHELD}"]`), '.wl-act .b', UNHELD, 'B on');
  await tradesAnswered; // the card is decided once Upstox Trade History has answered for this stock
  await sleep(800);
  const c = await readCard();
  if (c) {
    note(`${UNHELD} shows a card ("${c.title}"): the account held it before.`);
    await speak(`${UNHELD} is not held today; the card says "${c.title}": ${c.sum}.`);
  } else await speak("Not held, so there's no card. The ticket is exactly today's Upstox. We don't add noise where there's nothing to say.");
});

step(`${LOSS} → Sell → NSE (${SELL ? 'ONE sandbox SELL' : 'stops before Review'})`, async () => {
  await openFromRow(page.locator(`tbody tr[data-sym="${LOSS}"]`), '.row-act .s', LOSS, 'Sell');
  const btn = order.locator('button.review.sell');
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  const f = await settledTicket();
  see(`footer: ${f.req} · ${f.avail} · [${f.cta}]`);
  if (!SELL) {
    note('Stopped before Review: no order is placed. (Run with --sell-order against :3000 to place one sandbox SELL.)');
    await speak(`Selling needs no funds, so ${f.cta} is ready. Add-More is a buy-side card, so the sell ticket stays exactly Upstox's.`);
    return;
  }
  await beat(1);
  sellArmed = true;
  await safeClick(btn, 'Review sell order', 'sell-review');
  const sheet = page.locator('.sheet');
  await sheet.waitFor({ state: 'visible', timeout: 30000 });
  sellArmed = false;
  const meta = await text(sheet.locator('.meta'));
  const id = /Upstox sandbox order ([^\s.]+)/.exec(meta)?.[1];
  see(`sheet: ${await text(sheet.locator('h3'))} · ${await text(sheet.locator('.sub'))} · ${meta}`);
  await speak(
    id
      ? `Selling needs no funds, so this goes through. It's a real order on the Upstox sandbox; that's the order ID, ${id}. Add-More is a buy-side card, so the sell ticket stays exactly Upstox's.`
      : `Selling needs no funds, so this goes through, but the Upstox sandbox did not take the order right now, and the sheet says so: "${meta}"`,
  );
  await safeClick(sheet.locator('button.ok'), 'Done on the sell sheet', 'sell-done');
  await sheet.waitFor({ state: 'detached', timeout: 5000 });
});

step('US Stocks tab → row Buy (US ticket)', async () => {
  await safeClick(page.locator('.htabs .tab', { hasText: 'US Stocks' }), 'the US Stocks tab');
  await page.locator('.htabs .tab[data-mkt="US"].on').waitFor({ timeout: 5000 });
  const row = await until(
    async () => {
      const held = page.locator('tbody tr[data-sym]');
      if (await held.count()) return held.first();
      const msg = page.locator('tbody tr.msg');
      return (await msg.count()) && !/^Loading/.test(await text(msg)) ? msg.first() : null;
    },
    'the US Stocks row (Alpaca paper)',
    30000,
  );
  see(`US Stocks: ${await shown(row)}`);
  await beat(1);
  await row.hover();
  await beat();
  await row.hover();
  await safeClick(row.locator('.row-act .b'), 'Buy on the US row');
  await page.locator('section.order[data-mkt="US"]:not(.closed)').waitFor({ timeout: 15000 });
  await until(async () => (await order.locator('.amc, .amc-note').count()) > 0, 'the US card or its note', 30000);
  let c = await readCard();
  if (c) {
    await beat();
    await expandCard();
    c = await readCard();
  }
  const f = await readTicket();
  const fx = f.chips.find(x => /USD\/INR/.test(x.text));
  see(`ticket: ${f.name} ${f.px} · chips: ${chipsLine(f)}`);
  const opener = "There's no India/US switch: the stock you press decides the ticket.";
  if (c)
    await speak(
      `${opener} Same card for US stocks: "${c.sum}". Here the dollar average falls but the rupee average can rise, because the rupee moved since the buys. Prices come from Alpaca paper; USD/INR comes from Upstox's live feed. The chip names the exact key${fx ? `, "${fx.text}",` : ''} and each buy uses that day's close.`,
      1.5,
    );
  else if (/^Awaiting first fill/.test(f.note))
    await speak(`${opener} The Alpaca paper orders fill at the US open. Until then we say "${f.note}". No simulated position.`, 1.2);
  else await speak(`${opener} The ticket says: "${f.note}".`, 1.2);
});

step(`Phone width (${PHONE.width} px)`, async () => {
  await phoneWidth(true);
  const picker = page.locator('.mob-only select[aria-label="Stock"]');
  await picker.waitFor({ state: 'visible', timeout: 10000 });
  const t0 = Date.now();
  // "Same card": when the open ticket has none (US before its first fill), pick the demo's held stock in the phone's picker
  if (!(await readCard()) && (await picker.locator(`option[value="IN:${LOSS}"]`).count())) {
    await beat(0.6);
    await picker.selectOption(`IN:${LOSS}`);
    await waitTicket(LOSS);
    await waitCard();
  }
  out('SAY', "On a phone it's the order panel with a stock picker. Same card.", '1;36');
  console.log(`       ${paint('2', `      (on screen ~${Math.round(PHONE_MS / 1000)} s)`)}`);
  await sleep(Math.max(0, PHONE_MS * 0.4 - (Date.now() - t0)));
  if (await readCard()) await expandCard();
  await sleep(Math.max(0, PHONE_MS - (Date.now() - t0)));
  await phoneWidth(false);
  await page.locator('.mob-only').waitFor({ state: 'hidden', timeout: 5000 });
});

step('The proof: verify-card.mjs', async () => {
  act(`Switch to the terminal running: node scripts/verify-card.mjs ${DEMO_QTY}`);
  await speak('These numbers were recomputed from the raw Upstox JSON by a script that shares no code with the app. They match to the paisa.');
});

// ------------------------------------------------------------------ run
const results = [];
let finishing = false;
let shotDirMade = false;
browser.on('disconnected', () => {
  if (!finishing) {
    console.log('\nThe browser was closed.');
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  }
});
process.on('SIGINT', () => {
  if (finishing) process.exit(130);
  console.log('\nStopping…');
  finish(130);
});

/** Reads the Duration of a .webm (EBML Segment → Info → TimecodeScale × Duration), or null. */
function webmSeconds(file) {
  const b = fs.readFileSync(file);
  const vint = (at, keepMarker) => {
    const first = b[at];
    if (first === undefined || first === 0) return null;
    let len = 1;
    while (!(first & (0x80 >> (len - 1)))) len++;
    let v = keepMarker ? first : first & (0xff >> len);
    for (let k = 1; k < len; k++) v = v * 256 + b[at + k];
    return { v, len, unknown: !keepMarker && v === 2 ** (7 * len) - 1 };
  };
  let scale = 1e6;
  let dur = null;
  const walk = (start, end) => {
    for (let at = start; at < end; ) {
      const id = vint(at, true);
      if (!id) return;
      const size = vint(at + id.len, false);
      if (!size) return;
      const data = at + id.len + size.len;
      const stop = size.unknown ? end : Math.min(end, data + size.v);
      if (id.v === 0x18538067 || id.v === 0x1549a966) walk(data, stop); // Segment, Info
      else if (id.v === 0x2ad7b1) scale = b.readUIntBE(data, Math.min(size.v, 6)); // TimecodeScale
      else if (id.v === 0x4489) dur = size.v === 4 ? b.readFloatBE(data) : b.readDoubleBE(data); // Duration
      else if (id.v === 0x1f43b675) return; // first Cluster: Info is behind us
      if (dur !== null && id.v === 0x1549a966) return;
      at = stop;
    }
  };
  walk(0, b.length);
  return dur === null ? null : (dur * scale) / 1e9;
}

async function finish(code) {
  if (finishing) return;
  finishing = true;
  const video = o.video ? page.video() : null;
  await context.close().catch(() => {});
  if (video) {
    try {
      const src = await video.path();
      const dest = path.join(VIDEO_DIR, `demo-${stamp}.webm`);
      for (let k = 0; ; k++) {
        try {
          fs.renameSync(src, dest);
          break;
        } catch (e) {
          if (k >= 10) throw e;
          await sleep(300);
        }
      }
      const parsed = webmSeconds(dest);
      const secs = parsed ?? (Date.now() - videoStart) / 1000;
      const whole = Math.round(secs);
      console.log(
        `${paint('1', 'Video')}   ${dest}\n        ${DESKTOP.width}×${DESKTOP.height} · ${Math.floor(whole / 60)}:${p2(whole % 60)} (${secs.toFixed(1)} s${parsed === null ? ', wall clock' : ''}) · ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`,
      );
    } catch (e) {
      console.log(`The video could not be saved: ${e.message}`);
    }
  }
  await browser.close().catch(() => {});
  process.exit(code);
}

for (const [i, s] of steps.entries()) {
  if (finishing || !browser.isConnected()) break;
  console.log(`\n${paint('1', `${String(i + 1).padStart(2)}/${steps.length}`)}  ${paint('1', s.title)}`);
  const t0 = Date.now();
  try {
    await s.run();
    results.push({ n: i + 1, title: s.title, ok: true, secs: (Date.now() - t0) / 1000 });
  } catch (e) {
    if (finishing) break;
    const msg = norm(e.message).split(' Call log:')[0];
    results.push({ n: i + 1, title: s.title, ok: false, secs: (Date.now() - t0) / 1000, error: msg });
    console.log(paint('31', `       FAIL  ${msg}`));
    try {
      if (!shotDirMade) fs.mkdirSync(VIDEO_DIR, { recursive: true });
      shotDirMade = true;
      const shot = path.join(VIDEO_DIR, `demo-${stamp}-fail-step${i + 1}.png`);
      await page.screenshot({ path: shot });
      console.log(`             screenshot: ${shot}`);
    } catch {
      /* the page may be gone */
    }
    await closeExchangeDialog().catch(() => {});
  }
}

if (!finishing) {
  const failed = results.filter(r => !r.ok);
  console.log(
    `\n${paint('1', 'Result')}  ${results.length - failed.length}/${steps.length} steps OK · order POSTs blocked: ${blocked.length} · sandbox sells sent: ${sellsSent} · page errors: ${pageErrors.length}`,
  );
  for (const r of failed) console.log(paint('31', `        step ${r.n} ${r.title}: ${r.error}`));
  for (const e of pageErrors) console.log(paint('33', `        page error: ${norm(e).slice(0, 200)}`));
  if (!o.headless && process.stdin.isTTY) {
    console.log('\nPress Enter to close the browser.');
    await new Promise(r => {
      process.stdin.resume();
      process.stdin.once('data', r);
    });
  }
  await finish(failed.length ? 1 : 0);
}
