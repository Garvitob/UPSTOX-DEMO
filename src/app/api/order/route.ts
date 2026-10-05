import { NextResponse } from 'next/server';
import { orderFlags, placeOrder } from '@/server/order';
import { EQUITY_KEY } from '@/server/instruments';
import type { OrderRequest, OrderResult } from '@/lib/types';

// GET  /api/order → which placement flags are on (so the UI shows the "Sandbox order" chip only when in use).
// POST /api/order → place an India order on the Upstox sandbox (flag) — always 200 with an OrderResult.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(orderFlags(), { headers: { 'Cache-Control': 'no-store' } });
}

function parse(b: unknown): OrderRequest | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  const tab = o.tab === 'gtt' || o.tab === 'mtf' || o.tab === 'regular' ? o.tab : null;
  const side = o.side === 'BUY' || o.side === 'SELL' ? o.side : null;
  const order_type = o.order_type === 'LIMIT' ? 'LIMIT' : o.order_type === 'MARKET' ? 'MARKET' : null;
  const quantity = Number(o.quantity);
  const price = Number(o.price ?? 0);
  const symbol = String(o.symbol ?? '');
  const instrument_key = String(o.instrument_key ?? '');
  if (!tab || !side || !order_type || !Number.isInteger(quantity) || !(quantity > 0) || !(price >= 0) || !symbol || !EQUITY_KEY.test(instrument_key)) return null;
  if (side === 'SELL' && tab === 'mtf') return null; // MTF is a funded buy; a delivery sell goes through Regular
  return { tab, side, order_type, quantity, price, symbol, instrument_key };
}

/**
 * Only this app's own page may place an order. A cross-site form or text/plain POST cannot send a JSON content type
 * without a CORS preflight (which this route does not answer), and browsers mark such requests with Sec-Fetch-Site
 * and Origin. Returns why a request is refused, or null.
 */
function refuse(req: Request): string | null {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return 'content type must be application/json';
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return `cross-site request (${site})`;
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return 'bad origin';
    }
    if (originHost !== host) return 'cross-origin request';
  }
  return null;
}

export async function POST(req: Request) {
  const refused = refuse(req);
  if (refused) {
    const r: OrderResult = { ok: false, mode: 'not_wired', order_id: null, detail: refused };
    return NextResponse.json(r, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const o = parse(body);
  const result: OrderResult = o ? await placeOrder(o) : { ok: false, mode: 'not_wired', order_id: null, detail: 'invalid order request' };
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
