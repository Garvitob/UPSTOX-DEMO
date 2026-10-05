import { NextResponse } from 'next/server';
import { upstoxRequest } from '@/server/upstox';
import type { FundsPayload } from '@/lib/types';

// GET /api/funds → the account's equity funds from GET /v2/user/get-funds-and-margin?segment=SEC (OAuth token), shown
// in the ticket exactly as Upstox Pro shows it: "Available: ₹ 0.00", and "You've insufficient funds …" + "Add funds"
// when an order needs more. Live only — a cached balance would mislead. Upstox's funds service is closed daily
// 00:00–05:30 IST; the ticket then labels the balance unavailable instead of guessing.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function GET() {
  const r = await upstoxRequest<{ data?: { equity?: { available_margin?: number; used_margin?: number } } }>({
    path: '/v2/user/get-funds-and-margin?segment=SEC',
    token: 'oauth',
  });
  const eq = r.ok ? r.json.data?.equity : undefined;
  const available = num(eq?.available_margin);
  const body: FundsPayload = {
    source: available !== null ? 'live' : 'unavailable',
    available,
    used: num(eq?.used_margin),
    fetched_at: new Date().toISOString(),
    ...(r.ok ? (available === null ? { error: { code: 'upstream' as const, message: 'funds response without equity.available_margin' } } : {}) : { error: r.error }),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
