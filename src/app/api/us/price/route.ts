import { NextResponse } from 'next/server';
import { alpacaRequest, msIso, symbolOk } from '@/server/alpaca';
import { config } from '@/server/env';
import type { UsPricePayload } from '@/lib/types';

// GET /api/us/price?symbol=AAPL → latest IEX trade price and previous close (Alpaca market data, free feed),
// the listing exchange (/v2/assets) and the US market clock (/v2/clock) for the "US market opens …" note.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Snapshot {
  latestTrade?: { p?: number; t?: string };
  prevDailyBar?: { c?: number };
  dailyBar?: { c?: number; t?: string };
}
const assets = new Map<string, string | null>();
let clockMemo: { at: number; v: UsPricePayload['market'] } | null = null;

export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get('symbol') ?? config.usSymbol()).toUpperCase();
  const fetched_at = new Date().toISOString();
  if (!symbolOk(symbol)) return NextResponse.json({ error: { code: 'bad_request', message: 'bad symbol' } }, { status: 400 });

  const snapP = alpacaRequest<Snapshot>({ api: 'data', path: `/v2/stocks/${symbol}/snapshot?feed=iex` });
  const assetP = assets.has(symbol) ? null : alpacaRequest<{ exchange?: string }>({ api: 'trade', path: `/v2/assets/${symbol}` });
  const clockP = clockMemo && Date.now() - clockMemo.at < 60_000 ? null : alpacaRequest<{ is_open?: boolean; next_open?: string; next_close?: string }>({ api: 'trade', path: '/v2/clock' });
  const [snap, asset, clock] = await Promise.all([snapP, assetP, clockP]);

  if (asset?.ok) assets.set(symbol, asset.json.exchange ?? null);
  if (clock?.ok) clockMemo = { at: Date.now(), v: { is_open: !!clock.json.is_open, next_open: clock.json.next_open ?? null, next_close: clock.json.next_close ?? null } };

  if (!snap.ok) {
    const body: UsPricePayload = { source: 'unavailable', fetched_at, symbol, price: null, at: null, prev_close: null, exchange: assets.get(symbol) ?? null, market: clockMemo?.v ?? null, error: snap.error };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }
  const s = snap.json;
  const body: UsPricePayload = {
    source: typeof s.latestTrade?.p === 'number' ? 'live' : 'unavailable',
    fetched_at,
    symbol,
    price: s.latestTrade?.p ?? null,
    at: msIso(s.latestTrade?.t),
    prev_close: s.prevDailyBar?.c ?? null,
    exchange: assets.get(symbol) ?? null,
    market: clockMemo?.v ?? null,
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
