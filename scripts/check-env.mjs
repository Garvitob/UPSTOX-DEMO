// Verifies every key/token with a real call and writes data/env-check.json. Safe to re-run.
import fs from 'node:fs';
import { loadEnv, mask, getJSON } from './_env.mjs';
const env = loadEnv();
const out = { checked_at: new Date().toISOString(), results: {} };
const say = (k, ok, note) => { out.results[k] = { ok, note }; console.log(`${ok ? 'OK  ' : 'FAIL'} ${k.padEnd(24)} ${note}`); };

console.log('Keys present:');
for (const k of ['UPSTOX_API_KEY','UPSTOX_API_SECRET','UPSTOX_REDIRECT_URI','UPSTOX_ANALYTICS_TOKEN','UPSTOX_ACCESS_TOKEN','UPSTOX_SANDBOX_TOKEN','ALPACA_KEY_ID','ALPACA_SECRET_KEY'])
  console.log(`  ${k.padEnd(24)} ${mask(env[k])}`);
console.log('\nLive checks:');

// 1. Analytics token → LTP v3 on Nifty 50 (market data; works any day)
if (env.UPSTOX_ANALYTICS_TOKEN) {
  const r = await getJSON('https://api.upstox.com/v3/market-quote/ltp?instrument_key=' + encodeURIComponent('NSE_INDEX|Nifty 50'), { Authorization: `Bearer ${env.UPSTOX_ANALYTICS_TOKEN}` });
  const v = r.json?.data && Object.values(r.json.data)[0];
  say('analytics_token', r.status === 200 && !!v, r.status === 200 ? `Nifty 50 LTP ${v?.last_price}` : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
} else say('analytics_token', false, 'missing');

// 2. OAuth token → holdings (account data)
if (env.UPSTOX_ACCESS_TOKEN) {
  const r = await getJSON('https://api.upstox.com/v2/portfolio/long-term-holdings', { Authorization: `Bearer ${env.UPSTOX_ACCESS_TOKEN}` });
  const n = Array.isArray(r.json?.data) ? r.json.data.length : 0;
  say('oauth_token', r.status === 200, r.status === 200 ? `${n} holding(s): ${r.json.data.map(h => `${h.trading_symbol} ${h.quantity}@${h.average_price}`).join(', ') || 'none'}` : `HTTP ${r.status} → run: node scripts/upstox-login.mjs`);
} else say('oauth_token', false, 'missing → run: node scripts/upstox-login.mjs');

// 3. Alpaca paper → account
if (env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY) {
  const h = { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY };
  const a = await getJSON((env.ALPACA_PAPER_BASE || 'https://paper-api.alpaca.markets') + '/v2/account', h);
  say('alpaca_account', a.status === 200, a.status === 200 ? `status ${a.json.status}, buying power $${a.json.buying_power}` : `HTTP ${a.status}`);
  const p = await getJSON((env.ALPACA_PAPER_BASE || 'https://paper-api.alpaca.markets') + '/v2/positions', h);
  say('alpaca_positions', p.status === 200, p.status === 200 ? `${p.json.length} position(s)${p.json.length ? ': ' + p.json.map(x => `${x.symbol} ${x.qty}@${x.avg_entry_price}`).join(', ') : ' (fills land Monday US hours)'}` : `HTTP ${p.status}`);
} else say('alpaca', false, 'missing keys');

// 4. Sandbox token presence only (no read endpoints exist on sandbox)
say('sandbox_token', !!env.UPSTOX_SANDBOX_TOKEN, env.UPSTOX_SANDBOX_TOKEN ? 'present (order placement flag can be enabled)' : 'missing (optional — order flag stays off)');

// 5. Cache files
for (const f of ['holdings', 'trades']) {
  const p = `data/cache/${f}.json`;
  const ok = fs.existsSync(p);
  say(`cache_${f}`, ok, ok ? `fetched_at ${JSON.parse(fs.readFileSync(p, 'utf8')).fetched_at}` : 'missing → run: node scripts/fetch-upstox-cache.mjs');
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/env-check.json', JSON.stringify(out, null, 2));
console.log('\nWritten data/env-check.json');
