import { NextResponse } from 'next/server';
import { fxKey } from '@/server/instruments';
import { feedSnapshot } from '@/server/upstoxFeed';
import { upstoxRequest } from '@/server/upstox';
import { istDate } from '@/lib/format';
import type { ApiError, FxPayload } from '@/lib/types';

// GET /api/fx            → live USD/INR from Upstox's global indicator (feed tick → intraday candle → last daily close)
// GET /api/fx?date=YYYY-MM-DD → that day's USD/INR daily close (historical candles v3), or the nearest earlier close.
// LTP endpoints reject GLOBAL_INDICATOR|USDINR; the feed and candles accept it (preflight, docs/API_UPSTOX.md).
// Never a typed or default rate: without a key or data the response is "unavailable" with the real upstream error
// (missing_env / unauthorized / rate_limited / network / upstream).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Candle = [string, number, number, number, number, number, number];
type Candles = { ok: true; candles: Candle[] } | { ok: false; error: ApiError };
const DAY = 86_400_000;
const shift = (ymd: string, days: number) => istDate(Date.parse(`${ymd}T12:00:00+05:30`) + days * DAY);

const dailyMemo = new Map<string, Candle[]>(); // past windows never change

async function dailyCandles(key: string, from: string, to: string): Promise<Candles> {
  const memoKey = `${from}|${to}`;
  const today = istDate(Date.now());
  const hit = to < today ? dailyMemo.get(memoKey) : undefined;
  if (hit) return { ok: true, candles: hit };
  const r = await upstoxRequest<{ data?: { candles?: Candle[] } }>({
    path: `/v3/historical-candle/${encodeURIComponent(key)}/days/1/${to}/${from}`,
    token: 'analytics',
  });
  if (!r.ok) return { ok: false, error: r.error };
  const c = r.json?.data?.candles ?? [];
  if (to < today) dailyMemo.set(memoKey, c);
  return { ok: true, candles: c };
}

// A feed tick older than this is double-checked against the intraday minute candles (CTO, US-card gate: if the feed sends
// no USDINR update after the 09:00 open, the newest minute candle is the fresher Upstox value). Memoised for 30 s.
const STALE_TICK_MS = 5 * 60_000;
let intradayMemo: { at: number; key: string; r: Awaited<ReturnType<typeof fetchIntraday>> } | null = null;
async function fetchIntraday(key: string) {
  return upstoxRequest<{ data?: { candles?: Candle[] } }>({ path: `/v3/historical-candle/intraday/${encodeURIComponent(key)}/minutes/1`, token: 'analytics' });
}
async function intraday(key: string) {
  if (intradayMemo && intradayMemo.key === key && Date.now() - intradayMemo.at < 30_000) return intradayMemo.r;
  const r = await fetchIntraday(key);
  intradayMemo = { at: Date.now(), key, r };
  return r;
}
const intradayBody = (key: string, c: Candle): FxPayload => ({
  source: 'live',
  instrument_key: key,
  rate: c[4],
  basis: 'intraday',
  as_of: new Date(c[0]).toISOString(),
  date: c[0].slice(0, 10),
});

async function liveRate(key: string): Promise<{ ok: true; body: FxPayload } | { ok: false; error: ApiError }> {
  const snap = await feedSnapshot([key], 3000);
  const t = snap[key];
  if (t) {
    const at = t.ltt ?? t.at;
    const tick: FxPayload = { source: 'live', instrument_key: key, rate: t.ltp, basis: 'feed', as_of: new Date(at).toISOString(), date: istDate(at) };
    if (Date.now() - at <= STALE_TICK_MS) return { ok: true, body: tick };
    const i = await intraday(key);
    const newest = i.ok ? (i.json?.data?.candles ?? [])[0] : undefined; // newest first
    return { ok: true, body: newest && Date.parse(newest[0]) > at ? intradayBody(key, newest) : tick };
  }
  const r = await intraday(key);
  const latest = r.ok ? (r.json?.data?.candles ?? [])[0] : undefined; // newest first
  if (latest) return { ok: true, body: intradayBody(key, latest) };
  const today = istDate(Date.now());
  const d = await dailyCandles(key, shift(today, -14), today);
  if (!d.ok) return { ok: false, error: r.ok ? d.error : r.error }; // report the first real failure
  const last = d.candles[0];
  if (last) return { ok: true, body: { source: 'live', instrument_key: key, rate: last[4], basis: 'daily_close', as_of: new Date(last[0]).toISOString(), date: last[0].slice(0, 10) } };
  return { ok: false, error: r.ok ? { code: 'upstream', message: 'Upstox returned no USD/INR data for the last 14 days' } : r.error };
}

const validDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && istDate(Date.parse(`${s}T12:00:00+05:30`)) === s;

export async function GET(req: Request) {
  const key = fxKey();
  const date = new URL(req.url).searchParams.get('date');
  const base: FxPayload = { source: 'unavailable', instrument_key: key, rate: null, basis: null, as_of: null, date: null, ...(date ? { requested_date: date } : {}) };
  const json = (b: FxPayload, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!key) return json({ ...base, error: { code: 'unresolved', message: 'USD/INR feed unavailable: the Upstox USD INR instrument key is not resolved (see HUMAN_TODO.md)' } });

  if (!date) {
    const v = await liveRate(key);
    return json(v.ok ? v.body : { ...base, error: v.error });
  }
  if (!validDate(date)) return json({ ...base, error: { code: 'bad_request', message: 'date must be a real calendar date YYYY-MM-DD' } }, 400);
  const today = istDate(Date.now());
  if (date > today) return json({ ...base, error: { code: 'bad_request', message: 'date is in the future' } }, 400);

  const d = await dailyCandles(key, shift(date, -14), date);
  if (!d.ok) return json({ ...base, error: d.error });
  const exact = d.candles.find(c => c[0].slice(0, 10) === date);
  if (exact) return json({ ...base, source: 'live', rate: exact[4], basis: 'daily_close', as_of: new Date(exact[0]).toISOString(), date });
  if (date === today) {
    // today's daily candle is not closed yet: use today's live rate
    const v = await liveRate(key);
    if (v.ok) return json({ ...v.body, requested_date: date });
  }
  const prior = d.candles.filter(c => c[0].slice(0, 10) < date).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  if (prior) return json({ ...base, source: 'live', rate: prior[4], basis: 'daily_close', as_of: new Date(prior[0]).toISOString(), date: prior[0].slice(0, 10) });
  return json({ ...base, error: { code: 'upstream', message: `Upstox returned no USD/INR candle on or before ${date} (14-day window)` } });
}
