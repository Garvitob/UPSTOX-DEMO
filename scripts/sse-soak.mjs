// Phase 6 acceptance: keeps /api/stream open for N seconds (default 65) and reports every event type, the gaps between
// heartbeats, and any error. Keys are discovered from the app's own /api/holdings + /api/instruments (nothing hardcoded).
// Usage: node scripts/sse-soak.mjs [seconds]
const base = process.env.BASE || 'http://127.0.0.1:3000';
const secs = Number(process.argv[2] || 65);
const j = async p => (await fetch(base + p)).json();
const [hold, inst] = await Promise.all([j('/api/holdings'), j('/api/instruments')]);
const keys = [...new Set([...(hold.holdings || []).map(h => h.instrument_token), ...(inst.indices || []).map(i => i.instrument_key), ...(inst.fx ? [inst.fx.instrument_key] : [])])];
const t0 = Date.now();
const counts = {}; let heartbeats = 0, lastBeat = t0, maxGap = 0, errors = [], firstStatus = null, ticks = {};
const ctrl = new AbortController();
const stop = setTimeout(() => ctrl.abort(), secs * 1000);
try {
  const r = await fetch(`${base}/api/stream?keys=${encodeURIComponent(keys.join(','))}`, { signal: ctrl.signal });
  console.log(`HTTP ${r.status} ${r.headers.get('content-type')} · ${keys.length} keys`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { errors.push(`stream ended by server after ${((Date.now() - t0) / 1000).toFixed(1)} s`); break; }
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      if (chunk.startsWith(': heartbeat')) { heartbeats++; const now = Date.now(); maxGap = Math.max(maxGap, now - lastBeat); lastBeat = now; continue; }
      const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
      if (!data) continue;
      const e = JSON.parse(data);
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (e.type === 'status' && !firstStatus) firstStatus = e.feed;
      if (e.type === 'tick') ticks[e.key] = e.ltp;
    }
  }
} catch (e) { if (e.name !== 'AbortError') errors.push(e.message); }
clearTimeout(stop);
const held = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`held open ${held} s · events ${JSON.stringify(counts)} · first status ${firstStatus} · heartbeats ${heartbeats} (max gap ${(maxGap / 1000).toFixed(1)} s)`);
console.log(`ticks: ${Object.entries(ticks).map(([k, v]) => `${k.split('|')[1]}=${v}`).join(', ')}`);
console.log(errors.length ? `ERRORS: ${errors.join('; ')}` : 'no errors');
process.exit(errors.length ? 1 : 0);
