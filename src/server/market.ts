import 'server-only';
import { feed } from './upstoxFeed';
import { upstoxRequest } from './upstox';
import type { MarketStatus } from '@/lib/types';

// Market status per exchange (NSE / BSE) for the "Markets are closed" note and the price chip, so a BSE ticket says
// "BSE closed" from BSE's own status. The live feed's market_info is used when the feed is connected; otherwise
// GET /v2/market/status/{NSE|BSE} (Analytics token), memoised for 30 s per exchange.

export type Exch = 'NSE' | 'BSE';
const memo = new Map<Exch, { at: number; value: MarketStatus | null }>();

export async function marketStatus(exchange: Exch = 'NSE'): Promise<MarketStatus | null> {
  const fromFeed = feed.segment(`${exchange}_EQ`);
  if (fromFeed && feed.status().feed === 'connected') {
    return { exchange, status: fromFeed, open: fromFeed === 'NORMAL_OPEN', last_updated: null }; // feed market_info carries no timestamp
  }
  const m = memo.get(exchange);
  if (m && Date.now() - m.at < 30_000) return m.value;
  const r = await upstoxRequest<{ data?: { exchange: string; status: string; last_updated?: number } }>({ path: `/v2/market/status/${exchange}`, token: 'analytics' });
  const d = r.ok ? r.json.data : undefined;
  const value: MarketStatus | null = d ? { exchange: d.exchange, status: d.status, open: d.status === 'NORMAL_OPEN', last_updated: d.last_updated ?? null } : null;
  if (!r.ok) console.warn(`[market] ${exchange} status unavailable: ${r.error.code} ${r.error.message}`);
  memo.set(exchange, { at: Date.now(), value });
  return value;
}

/** NSE and BSE status in one call (both requests run in parallel). */
export async function marketStatuses(): Promise<Record<Exch, MarketStatus | null>> {
  const [NSE, BSE] = await Promise.all([marketStatus('NSE'), marketStatus('BSE')]);
  return { NSE, BSE };
}
