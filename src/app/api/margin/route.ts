import { NextResponse } from 'next/server';
import { EQUITY_KEY } from '@/server/instruments';
import { upstoxRequest } from '@/server/upstox';
import type { MarginPayload } from '@/lib/types';

// GET /api/margin?key=NSE_EQ|…&price=1656[&qty=3&side=BUY|SELL&product=MTF|D] → POST /v2/charges/margin (OAuth token)
// for exactly that order. Defaults (1 share, BUY, MTF) give Upstox Pro's "Buy for ₹522.80/share with MTF"; the
// ticket's "Required: ₹ …" is the same call for the real order (delivery BUY 1 @ 1656 → 1656.00, SELL → 0.00).
// No cache across tokens: when the token is not valid the figure is unavailable and the UI says so.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const memo = new Map<string, { at: number; body: MarginPayload }>();
const MAX_QTY = 9_999_999;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get('key') ?? '';
  const price = Number(sp.get('price'));
  const quantity = sp.has('qty') ? Number(sp.get('qty')) : 1;
  const side = (sp.get('side') ?? 'BUY').toUpperCase();
  const product = (sp.get('product') ?? 'MTF').toUpperCase();
  if (!EQUITY_KEY.test(key) || !(price > 0) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY || (side !== 'BUY' && side !== 'SELL') || (product !== 'MTF' && product !== 'D')) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'key must be an equity instrument key, price > 0, qty a whole number ≥ 1, side BUY|SELL, product MTF|D' } },
      { status: 400 },
    );
  }
  const mk = `${key}|${price}|${quantity}|${side}|${product}`;
  const hit = memo.get(mk);
  if (hit && Date.now() - hit.at < 60_000) return NextResponse.json(hit.body);
  const r = await upstoxRequest<{ data?: { required_margin?: number } }>({
    path: '/v2/charges/margin',
    method: 'POST',
    token: 'oauth',
    body: { instruments: [{ instrument_key: key, quantity, transaction_type: side, product, price }] },
  });
  const rm = r.ok ? r.json.data?.required_margin : undefined;
  const body: MarginPayload = {
    source: typeof rm === 'number' && Number.isFinite(rm) ? 'live' : 'unavailable',
    instrument_key: key,
    product: product as MarginPayload['product'],
    side: side as MarginPayload['side'],
    quantity,
    price,
    required_margin: typeof rm === 'number' && Number.isFinite(rm) ? rm : null,
    fetched_at: new Date().toISOString(),
    ...(r.ok ? {} : { error: r.error }),
  };
  if (body.source === 'live') {
    memo.set(mk, { at: Date.now(), body });
    if (memo.size > 500) memo.delete(memo.keys().next().value as string); // bounded: one entry per order shape
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
