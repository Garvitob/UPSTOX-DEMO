import { NextResponse } from 'next/server';
import { alpacaRequest, msIso, symbolOk } from '@/server/alpaca';
import { config } from '@/server/env';
import type { UsFill, UsFillsPayload } from '@/lib/types';

// GET /api/us/fills?symbol=AAPL → every FILL activity for the symbol on the Alpaca PAPER account, oldest first
// (paginated with page_token). The US card turns these into buy lots and looks up USD/INR on each fill date.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Raw = Record<string, unknown>;
const PAGE = 100;

export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get('symbol') ?? config.usSymbol()).toUpperCase();
  const fetched_at = new Date().toISOString();
  if (!symbolOk(symbol)) return NextResponse.json({ error: { code: 'bad_request', message: 'bad symbol' } }, { status: 400 });
  const fills: UsFill[] = [];
  let token: string | null = null;
  for (let i = 0; i < 50; i++) {
    const qs: string = `activity_types=FILL&direction=asc&page_size=${PAGE}${token ? `&page_token=${encodeURIComponent(token)}` : ''}`;
    const r = await alpacaRequest<Raw[]>({ api: 'trade', path: `/v2/account/activities?${qs}` });
    if (!r.ok) {
      const body: UsFillsPayload = { source: 'unavailable', fetched_at, symbol, fills: [], error: r.error };
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    }
    const rows = r.json ?? [];
    for (const a of rows) {
      if (String(a.symbol) !== symbol) continue;
      const time = msIso(a.transaction_time);
      const side = String(a.side);
      if (!time || (side !== 'buy' && side !== 'sell')) continue;
      fills.push({ id: String(a.id), order_id: String(a.order_id), transaction_time: time, side, price: Number(a.price), qty: Number(a.qty) });
    }
    if (rows.length < PAGE) break;
    token = String(rows[rows.length - 1].id);
  }
  fills.sort((a, b) => Date.parse(a.transaction_time) - Date.parse(b.transaction_time));
  const body: UsFillsPayload = { source: 'live', fetched_at, symbol, fills };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
