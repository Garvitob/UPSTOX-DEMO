import { NextResponse } from 'next/server';
import { instrumentsPayload, resolveEquity } from '@/server/instruments';

// GET /api/instruments → keys resolved from Upstox's public instrument master (data/instruments.json):
//   holdings + watchlist equities (with BSE listing and tick size), index keys + next F&O expiries, USD INR key.
// GET /api/instruments?isin=INE…  or  ?symbol=VEDL[&exchange=BSE] → resolve one equity on demand.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const isin = sp.get('isin') ?? undefined;
  const symbol = sp.get('symbol') ?? undefined;
  if (!isin && !symbol) return NextResponse.json(instrumentsPayload(), { headers: { 'Cache-Control': 'no-store' } });
  const exchange = sp.get('exchange') === 'BSE' ? 'BSE' : 'NSE';
  try {
    const hit = await resolveEquity({ isin, symbol, exchange });
    if (!hit) return NextResponse.json({ error: { code: 'unresolved', message: `no ${exchange} equity for ${isin ?? symbol}` } }, { status: 404 });
    return NextResponse.json(hit);
  } catch (e) {
    return NextResponse.json({ error: { code: 'network', message: `instrument master unreachable: ${(e as Error).message}` } }, { status: 502 });
  }
}
