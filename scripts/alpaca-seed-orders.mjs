// Places two REAL paper buys on Alpaca so a position with fills exists for the US tab.
// Fills happen during US sessions: the extended-hours limit from the overnight session (8:00 PM ET = 5:30 AM IST), the market
// order at the regular open (7:00 PM IST).
import { loadEnv, getJSON } from './_env.mjs';
const env = loadEnv();
if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) { console.error('ALPACA_KEY_ID / ALPACA_SECRET_KEY missing'); process.exit(1); }
const H = { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY, 'Content-Type': 'application/json' };
const trade = (env.ALPACA_PAPER_BASE || 'https://paper-api.alpaca.markets'), data = (env.ALPACA_DATA_BASE || 'https://data.alpaca.markets');
const sym = env.US_SYMBOL || 'AAPL';
// Never seed twice: pending weekend orders don't show as positions until they fill.
const existingOrders = await getJSON(`${trade}/v2/orders?status=all&limit=100&symbols=${sym}`, H);
const existingPos = await getJSON(`${trade}/v2/positions`, H);
if (existingOrders.status !== 200 || existingPos.status !== 200) { console.error(`Alpaca check failed: orders HTTP ${existingOrders.status}, positions HTTP ${existingPos.status}`); process.exit(1); }
const priorOrders = existingOrders.json.filter(o => o.symbol === sym && !['canceled', 'expired', 'rejected'].includes(o.status));
const priorPos = existingPos.json.filter(p => p.symbol === sym);
if ((priorOrders.length || priorPos.length) && !process.argv.includes('--force')) {
  console.log(`Already seeded — not placing new orders. ${sym}: ${priorOrders.length} order(s) [${priorOrders.map(o => `${o.side} ${o.qty} ${o.type} ${o.status}`).join('; ')}], ${priorPos.length} position(s).`);
  process.exit(0);
}
const last =await getJSON(`${data}/v2/stocks/${sym}/trades/latest?feed=iex`, H);
const price = Number(last.json?.trade?.p);
if (!price) { console.error('Could not read latest price:', JSON.stringify(last.json).slice(0, 200)); process.exit(1); }
console.log(`${sym} last trade $${price} (iex)`);
const post = async body => { const r = await fetch(`${trade}/v2/orders`, { method: 'POST', headers: H, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
const o1 = await post({ symbol: sym, qty: '1', side: 'buy', type: 'limit', limit_price: (price * 1.01).toFixed(2), time_in_force: 'day', extended_hours: true });
console.log('Extended-hours limit buy →', o1.status, o1.json.id || JSON.stringify(o1.json).slice(0, 200));
const o2 = await post({ symbol: sym, qty: '1', side: 'buy', type: 'market', time_in_force: 'day' });
console.log('Market buy →', o2.status, o2.json.id || JSON.stringify(o2.json).slice(0, 200));
const orders = await getJSON(`${trade}/v2/orders?status=all&limit=10`, H);
console.log('\nOpen/recent orders:'); for (const o of orders.json || []) console.log(`  ${o.symbol} ${o.side} ${o.qty} ${o.type} ${o.status} ${o.filled_qty ? 'filled ' + o.filled_qty + '@' + o.filled_avg_price : ''}`);
console.log('\nNote: both fill Monday (US sessions). Until then the US tab shows "Awaiting first fill". Re-run check-env.mjs later to confirm positions.');
