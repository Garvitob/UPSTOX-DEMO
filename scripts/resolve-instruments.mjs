// Resolves instrument keys from Upstox's public instrument master (no token needed):
// holdings ISINs (+ BSE listing), watchlist symbols, index keys + next F&O expiries, USD INR global key.
// Output: data/instruments.json. Never hardcode keys in the app — read this file (or re-resolve at runtime).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadEnv } from './_env.mjs';
const env = loadEnv();
const gz = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`); return JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')); };
const COMPLETE = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz';
const out = { resolved_at: new Date().toISOString(), source: COMPLETE, equities: {}, watchlist: { name: null, items: [] }, indices: {}, fx: null, notes: [] };

const holdings = fs.existsSync('data/cache/holdings.json') ? JSON.parse(fs.readFileSync('data/cache/holdings.json', 'utf8')).data : [];
// data/watchlist.json: either ["SYM", "BSE:SYM", ...] or { name, symbols: [...] }
const wlRaw = fs.existsSync('data/watchlist.json') ? JSON.parse(fs.readFileSync('data/watchlist.json', 'utf8')) : [];
const wlSymbols = (Array.isArray(wlRaw) ? wlRaw : wlRaw.symbols || []).map(s => { const [a, b] = String(s).split(':'); return b ? { exchange: a.toUpperCase(), symbol: b } : { exchange: 'NSE', symbol: a }; });
out.watchlist.name = Array.isArray(wlRaw) ? null : wlRaw.name || null;

console.log('Downloading complete.json.gz (large) …');
const all = await gz(COMPLETE);
const eq = { NSE: new Map(), BSE: new Map() }, eqByIsin = { NSE: new Map(), BSE: new Map() };
for (const i of all) {
  if (i.segment === 'NSE_EQ' || i.segment === 'BSE_EQ') {
    const ex = i.segment === 'NSE_EQ' ? 'NSE' : 'BSE';
    eq[ex].set(i.trading_symbol, i);
    if (i.isin) eqByIsin[ex].set(i.isin, i);
  }
}
const tick = i => (i && typeof i.tick_size === 'number' ? i.tick_size / 100 : null); // master stores paise

// Holdings: NSE key comes from the holding itself; BSE key only if the ISIN is listed on BSE.
for (const h of holdings) {
  const n = eqByIsin.NSE.get(h.isin), b = eqByIsin.BSE.get(h.isin);
  out.equities[h.isin] = {
    instrument_key: h.instrument_token, trading_symbol: h.trading_symbol, name: h.company_name,
    exchange: 'NSE', label: `NSE ${n?.instrument_type || 'EQ'}`, tick_size: tick(n),
    bse_key: b ? b.instrument_key : null, bse_tick_size: tick(b), source: 'holdings + complete.json',
  };
}

// Watchlist symbols
for (const w of wlSymbols) {
  const i = eq[w.exchange]?.get(w.symbol);
  if (!i) { out.notes.push(`watchlist symbol ${w.exchange}:${w.symbol} not found in the instrument master`); continue; }
  const b = w.exchange === 'NSE' ? eqByIsin.BSE.get(i.isin) : null;
  // A BSE watchlist entry that is also listed on NSE (e.g. PICCADIL) trades on both exchanges, so Buy / Sell asks
  // "Exchange to Buy From" exactly like Upstox Pro: the equity gets the NSE key as primary and the BSE key beside it.
  const n = w.exchange === 'BSE' ? eqByIsin.NSE.get(i.isin) : null;
  const item = { symbol: i.trading_symbol, exchange: w.exchange, isin: i.isin, name: i.name, instrument_key: i.instrument_key,
    label: `${w.exchange} ${i.instrument_type || 'EQ'}`, tick_size: tick(i), bse_key: b ? b.instrument_key : null, bse_tick_size: tick(b) };
  out.watchlist.items.push(item);
  if (!out.equities[i.isin]) out.equities[i.isin] = n
    ? { instrument_key: n.instrument_key, trading_symbol: i.trading_symbol, name: i.name || n.name, exchange: 'NSE', label: `NSE ${n.instrument_type || 'EQ'}`,
        tick_size: tick(n), bse_key: i.instrument_key, bse_tick_size: tick(i), source: 'watchlist (BSE) + NSE listing, complete.json' }
    : { instrument_key: i.instrument_key, trading_symbol: i.trading_symbol, name: i.name,
        exchange: w.exchange, label: item.label, tick_size: item.tick_size, bse_key: item.bse_key, bse_tick_size: item.bse_tick_size, source: 'watchlist + complete.json' };
}

// Indices (ticker) + next F&O expiries from the same master
const now = Date.now();
const nextExpiries = (seg, und) => [...new Set(all.filter(i => i.segment === seg && i.underlying_symbol === und && typeof i.expiry === 'number' && i.expiry >= now).map(i => i.expiry))].sort((a, b) => a - b).slice(0, 4);
const IDX = [
  { name: 'Nifty 50', label: 'NIFTY 50', seg: 'NSE_INDEX', fo: 'NSE_FO', und: 'NIFTY', match: i => i.segment === 'NSE_INDEX' && i.name === 'Nifty 50' },
  { name: 'Nifty Bank', label: 'BANKNIFTY', seg: 'NSE_INDEX', fo: 'NSE_FO', und: 'BANKNIFTY', match: i => i.segment === 'NSE_INDEX' && i.name === 'Nifty Bank' },
  { name: 'SENSEX', label: 'SENSEX', seg: 'BSE_INDEX', fo: 'BSE_FO', und: 'SENSEX', match: i => i.segment === 'BSE_INDEX' && i.trading_symbol === 'SENSEX' },
];
for (const x of IDX) {
  const hit = all.find(x.match);
  if (!hit) { out.notes.push(`index ${x.name} not found`); continue; }
  out.indices[x.name] = { instrument_key: hit.instrument_key, label: x.label, expiries: nextExpiries(x.fo, x.und) };
}

// USD INR global indicator
if (env.FX_KEY_OVERRIDE) out.fx = { instrument_key: env.FX_KEY_OVERRIDE, source: 'FX_KEY_OVERRIDE' };
else {
  const hit = all.find(i => /GLOBAL_INDICATOR/i.test(i.segment || '') && /USD\s*INR|USDINR/i.test(`${i.name} ${i.trading_symbol}`));
  if (hit) out.fx = { instrument_key: hit.instrument_key, name: hit.name, trading_symbol: hit.trading_symbol, latency: hit.latency,
    hours: `${hit.start_time} – ${hit.end_time}`, source: COMPLETE,
    verified: 'LTP v2/v3, quotes v2, OHLC v3 reject this key; historical + intraday candles v3 accept it (preflight 2026-10-04)' };
  else out.notes.push('USD INR key unresolved: open https://upstox.com/developer/api-documentation/instruments/ → find the "Global Instruments" file link → download → search name "USD INR" → put its instrument_key in .env.local as FX_KEY_OVERRIDE and re-run.');
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/instruments.json', JSON.stringify(out, null, 2));
const d = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
console.log('\nHoldings:', Object.values(out.equities).filter(e => e.source.startsWith('holdings')).map(e => `${e.trading_symbol}=${e.instrument_key} (BSE ${e.bse_key || '—'}, tick ₹${e.tick_size})`).join(', ') || 'none');
console.log('Watchlist:', out.watchlist.items.map(w => `${w.exchange}:${w.symbol}`).join(', ') || 'none');
console.log('Indices:', Object.entries(out.indices).map(([k, v]) => `${v.label}=${v.instrument_key} next exp ${v.expiries[0] ? d(v.expiries[0]) : '—'}`).join(' | '));
console.log('FX:', out.fx ? out.fx.instrument_key : 'UNRESOLVED');
for (const n of out.notes) console.log('note:', n);
console.log('\nWritten data/instruments.json');
