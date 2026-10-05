// Independent cross-check of the Add-More Check numbers. Reads the RAW Upstox responses (holdings with the OAuth
// token, or the cache if it has expired; LTP v3 with the Analytics token) and recomputes every card figure with the
// SPEC formulas written out again here — it deliberately shares no code with src/, so it can catch app bugs.
// Usage: node scripts/verify-card.mjs [qty=3]     → compare the printout with the card in the browser.
import fs from 'node:fs';
import { loadEnv, getJSON } from './_env.mjs';
const env = loadEnv();
const q = Number(process.argv[2] || 3);

let holdings, source;
const live = env.UPSTOX_ACCESS_TOKEN ? await getJSON('https://api.upstox.com/v2/portfolio/long-term-holdings', { Authorization: `Bearer ${env.UPSTOX_ACCESS_TOKEN}` }) : { status: 0 };
if (live.status === 200) { holdings = live.json.data; source = 'live /v2/portfolio/long-term-holdings'; }
else { const c = JSON.parse(fs.readFileSync('data/cache/holdings.json', 'utf8')); holdings = c.data; source = `cache fetched_at ${c.fetched_at} (live HTTP ${live.status})`; }

const keys = holdings.map(h => h.instrument_token);
const l = await getJSON('https://api.upstox.com/v3/market-quote/ltp?instrument_key=' + keys.map(encodeURIComponent).join(','), { Authorization: `Bearer ${env.UPSTOX_ANALYTICS_TOKEN}` });
if (l.status !== 200) { console.error('LTP v3 failed', l.status, JSON.stringify(l.json).slice(0, 200)); process.exit(1); }
const ltp = {}; for (const v of Object.values(l.json.data)) ltp[v.instrument_token] = v.last_price;

const r = (n, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const p1 = n => Math.abs(n * 100).toFixed(1) + '%';
console.log(`Holdings: ${source}\nLTP v3: ${new Date().toISOString()}   order: buy ${q} at market\n`);
for (const h of holdings) {
  const Q = h.quantity + h.t1_quantity, A = h.average_price, L = ltp[h.instrument_token];
  const newAvg = (Q * A + q * L) / (Q + q);
  console.log(`${h.trading_symbol.padEnd(6)} Q ${Q} (qty ${h.quantity} + t1 ${h.t1_quantity})  A ₹${r(A)}  L ₹${r(L)}`);
  console.log(`  Average   ₹${r(A)} → ₹${r(newAvg)}   (${newAvg < A ? 'lowers' : newAvg > A ? 'raises' : 'keeps'})`);
  console.log(`  Break-even ${p1(newAvg / L - 1)} ${newAvg >= L ? 'above' : 'below'} today's price (was ${p1(A / L - 1)})`);
  console.log(`  10% move  ₹${r(0.1 * Q * L, 0)} → ₹${r(0.1 * (Q + q) * L, 0)}    puts ₹${r(q * L, 0)} more    shares ${Q} → ${Q + q}\n`);
}
