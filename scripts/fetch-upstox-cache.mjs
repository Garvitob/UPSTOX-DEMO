// Fetches REAL account data with the daily OAuth token and caches it with a timestamp (the app's fallback when the
// token has expired). Output: data/cache/holdings.json, trades.json, trades-today.json, positions.json, profile.json.
// Re-run any time the token is fresh. Never stores the account holder's name (profile keeps initials only).
import fs from 'node:fs';
import { loadEnv, getJSON } from './_env.mjs';
const env = loadEnv();
if (!env.UPSTOX_ACCESS_TOKEN) { console.error('UPSTOX_ACCESS_TOKEN missing → node scripts/upstox-login.mjs'); process.exit(1); }
const H = { Authorization: `Bearer ${env.UPSTOX_ACCESS_TOKEN}` };
const base = 'https://api.upstox.com';
const ist = new Date(Date.now() + 5.5 * 3600e3); // calendar date in IST
const endDate = ist.toISOString().slice(0, 10);
const fy = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
fs.mkdirSync('data/cache', { recursive: true });
const write = (name, data, extra = {}) => fs.writeFileSync(`data/cache/${name}.json`, JSON.stringify({ source: 'upstox_api', fetched_at: new Date().toISOString(), ...extra, data }, null, 2));

// Holdings
const h = await getJSON(`${base}/v2/portfolio/long-term-holdings`, H);
if (h.status !== 200) { console.error(`Holdings HTTP ${h.status}: ${JSON.stringify(h.json).slice(0, 200)}\nToken probably expired → node scripts/upstox-login.mjs`); process.exit(1); }
write('holdings', h.json.data, { endpoint: '/v2/portfolio/long-term-holdings' });
console.log(`Holdings (${h.json.data.length}):`);
for (const x of h.json.data) console.log(`  ${x.trading_symbol.padEnd(12)} qty ${x.quantity} t1 ${x.t1_quantity} avg ${x.average_price} ltp ${x.last_price} isin ${x.isin} key ${x.instrument_token}`);

// Trade history: SPEC → try the FY three years back first; on UDAPI1093 keep the next FY start.
let all = null, startDate = null;
for (const start of [`${fy - 3}-04-01`, `${fy - 2}-04-01`]) {
  const rows = []; let page = 1, pages = 1, err = null;
  do {
    const r = await getJSON(`${base}/v2/charges/historical-trades?segment=EQ&start_date=${start}&end_date=${endDate}&page_number=${page}&page_size=5000`, H);
    if (r.status !== 200) { err = r; break; }
    rows.push(...(r.json.data || []));
    const meta = r.json.metaData?.page || r.json.meta_data?.page || r.json.metadata?.page || {};
    pages = meta.total_pages || 1; page += 1;
  } while (page <= pages);
  if (!err) { all = rows; startDate = start; break; }
  const code = err.json?.errors?.[0]?.errorCode;
  console.log(`Trade history from ${start}: HTTP ${err.status} ${code || ''}${code === 'UDAPI1093' ? ' (outside the 3-FY limit, trying the next FY start)' : ''}`);
  if (code !== 'UDAPI1093') break;
}
if (all) {
  write('trades', all, { endpoint: '/v2/charges/historical-trades', start_date: startDate, end_date: endDate, segment: 'EQ' });
  console.log(`\nTrade history since ${startDate}: ${all.length} row(s)`);
  const byIsin = {};
  for (const t of all) { const b = (byIsin[t.isin] ||= { symbol: t.symbol, buys: 0, sells: 0, net: 0 }); if (t.transaction_type === 'BUY') { b.buys++; b.net += t.quantity; } else { b.sells++; b.net -= t.quantity; } }
  for (const [isin, b] of Object.entries(byIsin)) console.log(`  ${b.symbol.padEnd(12)} ${isin}  buys ${b.buys}  sells ${b.sells}  net ${b.net}${b.net <= 0 && b.sells ? '  ← sold out (re-entry memory candidate)' : ''}`);
} else console.log('Trade history not cached (see above).');

// Today's trades
const d = await getJSON(`${base}/v2/order/trades/get-trades-for-day`, H);
write('trades-today', d.status === 200 ? d.json.data : [], { endpoint: '/v2/order/trades/get-trades-for-day', http: d.status });
console.log(`\nToday's trades: ${d.status === 200 ? (d.json.data || []).length : 'HTTP ' + d.status}`);

// Short-term positions (top bar "Pos. Total P&L")
const p = await getJSON(`${base}/v2/portfolio/short-term-positions`, H);
if (p.status === 200) { write('positions', p.json.data || [], { endpoint: '/v2/portfolio/short-term-positions' }); console.log(`Positions: ${(p.json.data || []).length}`); }

// Profile → initials only (avatar tile)
const pr = await getJSON(`${base}/v2/user/profile`, H);
if (pr.status === 200 && pr.json.data?.user_name) {
  const initials = pr.json.data.user_name.split(/[\s()]+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  write('profile', { initials }, { endpoint: '/v2/user/profile (initials only)' });
  console.log(`Profile initials: ${initials}`);
}
console.log('\nCached to data/cache/*.json (fetched_at stamped). Next: node scripts/resolve-instruments.mjs');
