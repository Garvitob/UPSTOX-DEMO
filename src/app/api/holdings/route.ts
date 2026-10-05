import { NextResponse } from 'next/server';
import { liveOrCache } from '@/server/cache';
import { config } from '@/server/env';
import { toTodayTrade } from '@/server/todayTrades';
import { upstoxRequest } from '@/server/upstox';
import { initialsOf, istDate } from '@/lib/format';
import type { HoldingRow, HoldingsPayload, Source, TradeRow } from '@/lib/types';

// GET /api/holdings → Upstox long-term holdings (OAuth token), live or cached, plus the positions P&L total
// for the top bar and the avatar initials. All three are real API responses; none is ever invented.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Raw = Record<string, unknown>;
const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function toRow(h: Raw): HoldingRow {
  return {
    isin: s(h.isin),
    trading_symbol: s(h.trading_symbol ?? h.tradingsymbol),
    company_name: s(h.company_name),
    instrument_token: s(h.instrument_token),
    exchange: s(h.exchange),
    product: s(h.product),
    quantity: n(h.quantity),
    t1_quantity: n(h.t1_quantity),
    cnc_used_quantity: n(h.cnc_used_quantity),
    average_price: n(h.average_price),
    last_price: n(h.last_price),
    close_price: n(h.close_price),
    pnl: n(h.pnl),
  };
}

async function positions(): Promise<HoldingsPayload['positions']> {
  const p = await liveOrCache<Raw[]>('positions', async () => {
    const r = await upstoxRequest<{ data: Raw[] }>({ path: '/v2/portfolio/short-term-positions', token: 'oauth' });
    return r.ok ? { ok: true, data: r.json.data ?? [], meta: { endpoint: '/v2/portfolio/short-term-positions' } } : { ok: false, error: r.error };
  });
  if (!p.data) return { source: p.source as Source, total_pnl: null, count: 0 };
  return { source: p.source, total_pnl: p.data.reduce((sum, x) => sum + n(x.pnl), 0), count: p.data.length };
}

/** Today's executed delivery trades for the card's starting position (CPO ruling Q1), live or cached. */
async function todayTrades(): Promise<HoldingsPayload['today']> {
  const p = await liveOrCache<Raw[]>('trades-today', async () => {
    const r = await upstoxRequest<{ data: Raw[] }>({ path: '/v2/order/trades/get-trades-for-day', token: 'oauth' });
    return r.ok ? { ok: true, data: r.json.data ?? [], meta: { endpoint: '/v2/order/trades/get-trades-for-day' } } : { ok: false, error: r.error };
  });
  if (!p.data || !p.fetched_at) return { source: 'unavailable', fetched_at: null, trades: [], ...(p.error ? { error: p.error } : {}) };
  const day = istDate(Date.parse(p.fetched_at));
  const trades = p.data.map(t => toTodayTrade(t, day)).filter((t): t is TradeRow => t !== null);
  return { source: p.source, fetched_at: p.fetched_at, trades, ...(p.error ? { error: p.error } : {}) };
}

async function initials(): Promise<string | null> {
  // Only the initials are kept (avatar tile); the account holder's name never leaves the server.
  const p = await liveOrCache<{ initials: string }>('profile', async () => {
    const r = await upstoxRequest<{ data: { user_name?: string } }>({ path: '/v2/user/profile', token: 'oauth' });
    return r.ok && r.json.data?.user_name
      ? { ok: true, data: { initials: initialsOf(r.json.data.user_name) }, meta: { endpoint: '/v2/user/profile (initials only)' } }
      : { ok: false, error: r.ok ? { code: 'upstream', message: 'profile without user_name' } : r.error };
  });
  // No profile and no cached initials → no initials (never guess them from the account label).
  return p.data?.initials ?? null;
}

export async function GET() {
  const h = await liveOrCache<Raw[]>('holdings', async () => {
    const r = await upstoxRequest<{ data: Raw[] }>({ path: '/v2/portfolio/long-term-holdings', token: 'oauth' });
    return r.ok ? { ok: true, data: r.json.data ?? [], meta: { endpoint: '/v2/portfolio/long-term-holdings' } } : { ok: false, error: r.error };
  });
  const [pos, ini, today] = await Promise.all([positions(), initials(), todayTrades()]);
  const body: HoldingsPayload = {
    source: h.source,
    fetched_at: h.fetched_at,
    label: config.accountLabel(),
    initials: ini,
    holdings: (h.data ?? []).map(toRow).sort((a, b) => a.trading_symbol.localeCompare(b.trading_symbol)),
    positions: pos,
    today,
    ...(h.error ? { error: h.error } : {}),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
