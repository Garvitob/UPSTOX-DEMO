// Calls every route of the running app (npm run dev) and prints the REAL values it returns. Keys and symbols are
// discovered from the app's own /api/instruments and /api/holdings responses — nothing is hardcoded here.
// Usage: node scripts/smoke-api.mjs   (BASE=http://127.0.0.1:3000 by default)
const base = process.env.BASE || 'http://127.0.0.1:3000';
const get = async path => {
  const t0 = Date.now();
  try {
    const r = await fetch(base + path, { cache: 'no-store' });
    const j = await r.json();
    return { status: r.status, ms: Date.now() - t0, j };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, j: { error: e.message } };
  }
};
const line = (label, r, summary) => console.log(`${String(r.status).padEnd(4)} ${label.padEnd(46)} ${String(r.ms).padStart(5)} ms  ${summary}`);
const err = j => (j && j.error ? ` · error ${j.error.code || ''} ${j.error.message || j.error}` : '');

const inst = await get('/api/instruments');
line('/api/instruments', inst, `${inst.j.equities?.length ?? 0} equities, watchlist ${inst.j.watchlist?.items?.length ?? 0}, indices ${(inst.j.indices || []).map(i => i.label).join('/')}, fx ${inst.j.fx?.instrument_key ?? '—'}${err(inst.j)}`);

const hold = await get('/api/holdings');
line('/api/holdings', hold, `source ${hold.j.source} fetched ${hold.j.fetched_at} · ${(hold.j.holdings || []).map(h => `${h.trading_symbol} ${h.quantity}+${h.t1_quantity}@${h.average_price}`).join(', ')} · positions pnl ${hold.j.positions?.total_pnl} · initials ${hold.j.initials}${err(hold.j)}`);

const first = (hold.j.holdings || [])[0];
if (first) {
  const tr = await get(`/api/trades?isin=${first.isin}`);
  line(`/api/trades?isin=${first.isin}`, tr, `source ${tr.j.source} window ${tr.j.window?.start_date}→${tr.j.window?.end_date} · ${tr.j.trades?.length ?? 0} row(s) for ${first.trading_symbol}${err(tr.j)}`);
}

const keys = [...new Set([...(hold.j.holdings || []).map(h => h.instrument_token), ...(inst.j.indices || []).map(i => i.instrument_key)])];
const ltp = await get(`/api/ltp?keys=${encodeURIComponent(keys.join(','))}&ltt=1`);
line('/api/ltp?keys=<holdings+indices>&ltt=1', ltp, `${Object.values(ltp.j.quotes || {}).map(q => `${q.instrument_key.split('|')[1]} ${q.last_price} (cp ${q.cp}${q.ltt ? `, ltt ${new Date(q.ltt).toISOString()}` : ''})`).join(' · ')} · market ${ltp.j.market?.status}${err(ltp.j)}`);

const fx = await get('/api/fx');
line('/api/fx', fx, `${fx.j.instrument_key} rate ${fx.j.rate} basis ${fx.j.basis} as_of ${fx.j.as_of}${err(fx.j)}`);
const fxd = await get('/api/fx?date=2026-10-01');
line('/api/fx?date=2026-10-01', fxd, `rate ${fxd.j.rate} basis ${fxd.j.basis} date ${fxd.j.date}${err(fxd.j)}`);

if (first) {
  const L = ltp.j.quotes?.[first.instrument_token]?.last_price;
  if (L) {
    const m = await get(`/api/margin?key=${encodeURIComponent(first.instrument_token)}&price=${L}`);
    line(`/api/margin?key=${first.trading_symbol}&price=${L}`, m, `MTF required_margin for 1 share ${m.j.required_margin} (source ${m.j.source})${err(m.j)}`);
  }
}

const pos = await get('/api/us/positions');
line('/api/us/positions', pos, `${pos.j.symbol}: ${pos.j.position ? `${pos.j.position.qty} @ ${pos.j.position.avg_entry_price}` : 'no position'} · pending ${(pos.j.pending_orders || []).map(o => `${o.side} ${o.qty} ${o.type} ${o.status} ${o.created_at}`).join('; ')}${err(pos.j)}`);
if (pos.j.symbol) {
  const fills = await get(`/api/us/fills?symbol=${pos.j.symbol}`);
  line(`/api/us/fills?symbol=${pos.j.symbol}`, fills, `${fills.j.fills?.length ?? 0} fill(s)${err(fills.j)}`);
  const px = await get(`/api/us/price?symbol=${pos.j.symbol}`);
  line(`/api/us/price?symbol=${pos.j.symbol}`, px, `$${px.j.price} at ${px.j.at} prev close ${px.j.prev_close} ${px.j.exchange} · US open ${px.j.market?.is_open} next ${px.j.market?.next_open}${err(px.j)}`);
}

const flags = await get('/api/order');
line('/api/order (GET flags)', flags, JSON.stringify(flags.j));

// SSE: read the stream for a few seconds
const t0 = Date.now();
try {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/api/stream?keys=${encodeURIComponent(keys.join(','))}`, { signal: ctrl.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', events = [];
  const stop = setTimeout(() => ctrl.abort(), 6000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
        if (data) events.push(JSON.parse(data));
      }
    }
  } catch { /* aborted after 6 s */ }
  clearTimeout(stop);
  const ticks = events.filter(e => e.type === 'tick');
  const status = events.filter(e => e.type === 'status').map(e => e.feed).join('→');
  const market = events.filter(e => e.type === 'market').map(e => `${e.segment}:${e.status}`).join(',');
  line('/api/stream (6 s)', { status: r.status, ms: Date.now() - t0 }, `${events.length} event(s): status ${status || '—'} · ${ticks.length} tick(s) ${ticks.slice(0, 4).map(t => `${t.key.split('|')[1]} ${t.ltp}`).join(', ')} · market ${market || '—'}`);
} catch (e) {
  console.log(`ERR  /api/stream ${e.message}`);
}
