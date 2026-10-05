import { NextResponse } from 'next/server';
import { EQUITY_KEY, knownMarketKeys } from '@/server/instruments';
import { marketStatuses } from '@/server/market';
import { feedSnapshot } from '@/server/upstoxFeed';
import { keyList, upstoxRequest } from '@/server/upstox';
import type { ApiError, LtpPayload, Quote } from '@/lib/types';

// GET /api/ltp?keys=a,b[&ltt=1] → LTP v3 (Analytics token) for the given instrument keys, keyed by key, plus
// NSE and BSE market status. With ltt=1 the last trade time comes from the live feed snapshot, else full quote v2.
// Market data is always live; it is never read from a cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LtpV3 {
  data?: Record<string, { last_price: number; instrument_token: string; cp?: number }>;
}
interface QuoteV2 {
  data?: Record<string, { instrument_token: string; last_trade_time?: string | number }>;
}

const chunks = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function ltpBatch(keys: string[]): Promise<{ quotes: Record<string, Quote>; error?: ApiError }> {
  const quotes: Record<string, Quote> = {};
  const r = await upstoxRequest<LtpV3>({ path: `/v3/market-quote/ltp?instrument_key=${keyList(keys)}`, token: 'analytics' });
  if (!r.ok) {
    // One invalid key fails the whole batch (UDAPI100095) — retry the keys one by one so the rest still load.
    if (r.status === 400 && keys.length > 1) {
      let firstErr: ApiError | undefined;
      for (const k of keys) {
        const one = await ltpBatch([k]);
        Object.assign(quotes, one.quotes);
        firstErr ??= one.error;
      }
      return { quotes, error: firstErr };
    }
    return { quotes, error: r.error };
  }
  for (const v of Object.values(r.json.data ?? {})) {
    // A quote without a usable price is left out (the client shows "—"), so no card is ever computed from 0 or NaN.
    if (!(Number.isFinite(v.last_price) && v.last_price > 0)) continue;
    const cp = typeof v.cp === 'number' && Number.isFinite(v.cp) && v.cp > 0 ? v.cp : null;
    quotes[v.instrument_token] = { instrument_key: v.instrument_token, last_price: v.last_price, cp, ltt: null };
  }
  return { quotes };
}

async function lastTradeTimes(keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const snap = await feedSnapshot(keys, 2500); // live feed snapshot carries ltpc.ltt
  for (const [k, v] of Object.entries(snap)) if (v.ltt) out[k] = v.ltt;
  const missing = keys.filter(k => !(k in out));
  for (const part of chunks(missing, 100)) {
    const r = await upstoxRequest<QuoteV2>({ path: `/v2/market-quote/quotes?instrument_key=${keyList(part)}`, token: 'analytics' });
    if (!r.ok) continue;
    for (const v of Object.values(r.json.data ?? {})) {
      const t = Number(v.last_trade_time);
      if (Number.isFinite(t) && t > 0) out[v.instrument_token] = t;
    }
  }
  return out;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const requested = [...new Set((sp.get('keys') ?? '').split(',').map(k => k.trim()).filter(Boolean))];
  const known = knownMarketKeys();
  const keys = requested.filter(k => known.has(k) || EQUITY_KEY.test(k)).slice(0, 300);
  const rejected = requested.filter(k => !keys.includes(k));
  if (keys.length === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'no valid instrument keys', rejected } }, { status: 400 });
  }
  const parts = await Promise.all(chunks(keys, 100).map(ltpBatch));
  const quotes: Record<string, Quote> = Object.assign({}, ...parts.map(p => p.quotes));
  const error = parts.find(p => p.error)?.error;
  if (sp.get('ltt') === '1') {
    const ltt = await lastTradeTimes(Object.keys(quotes));
    for (const [k, t] of Object.entries(ltt)) if (quotes[k]) quotes[k].ltt = t;
  }
  const markets = await marketStatuses();
  const body: LtpPayload & { rejected?: string[] } = {
    source: Object.keys(quotes).length ? 'live' : 'unavailable',
    fetched_at: new Date().toISOString(),
    quotes,
    market: markets.NSE,
    markets,
    ...(error ? { error } : {}),
    ...(rejected.length ? { rejected } : {}),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
