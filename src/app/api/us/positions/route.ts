import { NextResponse } from 'next/server';
import { alpacaRequest } from '@/server/alpaca';
import { config } from '@/server/env';
import type { UsPendingOrder, UsPosition, UsPositionsPayload } from '@/lib/types';

// GET /api/us/positions → the Alpaca PAPER position for US_SYMBOL (or null) and its open orders, so the US tab can
// say "Awaiting first fill (orders placed <date>)" instead of inventing a position.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export async function GET() {
  const symbol = config.usSymbol();
  const [p, o] = await Promise.all([
    alpacaRequest<Raw[]>({ api: 'trade', path: '/v2/positions' }),
    alpacaRequest<Raw[]>({ api: 'trade', path: `/v2/orders?status=open&symbols=${encodeURIComponent(symbol)}&limit=100&direction=asc` }),
  ]);
  const fetched_at = new Date().toISOString();
  if (!p.ok) {
    const body: UsPositionsPayload = { source: 'unavailable', fetched_at, symbol, position: null, pending_orders: [], error: p.error };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }
  const raw = (p.json ?? []).find(x => String(x.symbol) === symbol);
  const position: UsPosition | null = raw
    ? {
        symbol,
        qty: Number(raw.qty),
        avg_entry_price: Number(raw.avg_entry_price),
        current_price: num(raw.current_price),
        lastday_price: num(raw.lastday_price),
        exchange: raw.exchange ? String(raw.exchange) : null,
      }
    : null;
  const pending: UsPendingOrder[] = o.ok
    ? (o.json ?? [])
        .filter(x => String(x.symbol) === symbol && String(x.side) === 'buy')
        .map(x => ({ id: String(x.id), created_at: String(x.created_at), qty: Number(x.qty ?? 0), side: String(x.side), type: String(x.type ?? x.order_type), status: String(x.status) }))
    : [];
  const body: UsPositionsPayload = { source: 'live', fetched_at, symbol, position, pending_orders: pending, ...(o.ok ? {} : { error: o.error }) };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
