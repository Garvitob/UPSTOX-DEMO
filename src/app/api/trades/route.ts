import { NextResponse } from 'next/server';
import { liveOrCache, type LiveResult, type Sourced } from '@/server/cache';
import { upstoxRequest } from '@/server/upstox';
import { istDate } from '@/lib/format';
import type { ApiError, TradeRow, TradesPayload } from '@/lib/types';

// GET /api/trades?isin=INE… → BUY/SELL rows of one ISIN from Upstox Trade History (OAuth), oldest first, plus
// the window actually used. Live or cached. The whole window is fetched once and memoised for 5 minutes.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Raw = Record<string, unknown>;
interface Page {
  data?: Raw[];
  metaData?: { page?: { total_pages?: number } };
  meta_data?: { page?: { total_pages?: number } };
  metadata?: { page?: { total_pages?: number } };
}

/** Upstox documents trade_date as YYYY-MM-DD; also accept an ISO timestamp or DD-MM-YYYY defensively. */
function normYmd(v: unknown): string {
  const s = String(v ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return '';
}

/** Normalised row, or null for anything that is not a dated BUY/SELL with a positive price and quantity. */
function toTrade(t: Raw): TradeRow | null {
  const side = String(t.transaction_type ?? '').toUpperCase();
  const row: TradeRow = {
    trade_date: normYmd(t.trade_date),
    transaction_type: side === 'SELL' ? 'SELL' : 'BUY',
    price: Number(t.price),
    quantity: Number(t.quantity),
    isin: String(t.isin ?? ''),
    symbol: String(t.symbol ?? t.scrip_name ?? ''),
    ...(t.trade_id ? { trade_id: String(t.trade_id) } : {}),
  };
  if ((side !== 'BUY' && side !== 'SELL') || !row.trade_date || !(row.price > 0) || !(row.quantity > 0)) return null;
  return row;
}
const isTrade = (t: TradeRow | null): t is TradeRow => t !== null;

let workingStart: string | null = null; // remembers which start date Upstox accepted (3-FY limit)

/** SPEC: try the FY three years back first; on UDAPI1093 use the next FY start. */
function candidateStarts(today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  const all = [`${fy - 3}-04-01`, `${fy - 2}-04-01`];
  return workingStart && all.includes(workingStart) ? [workingStart] : all;
}

async function fetchWindow(): Promise<LiveResult<TradeRow[]>> {
  const today = istDate(Date.now());
  let last: ApiError = { code: 'upstream', message: 'no trade-history window accepted' };
  for (const start of candidateStarts(today)) {
    const rows: TradeRow[] = [];
    let page = 1;
    let pages = 1;
    let failed: ApiError | null = null;
    do {
      const r = await upstoxRequest<Page>({
        path: `/v2/charges/historical-trades?segment=EQ&start_date=${start}&end_date=${today}&page_number=${page}&page_size=5000`,
        token: 'oauth',
      });
      if (!r.ok) {
        failed = r.error;
        break;
      }
      rows.push(...(r.json.data ?? []).map(toTrade).filter(isTrade));
      const meta = r.json.metaData ?? r.json.meta_data ?? r.json.metadata;
      pages = meta?.page?.total_pages ?? 1;
      page += 1;
    } while (page <= pages);
    if (!failed) {
      workingStart = start;
      return { ok: true, data: rows, meta: { endpoint: '/v2/charges/historical-trades', start_date: start, end_date: today, segment: 'EQ' } };
    }
    last = failed;
    if (failed.upstream_code !== 'UDAPI1093') break; // only the FY-limit error moves on to the next start date
  }
  return { ok: false, error: last };
}

let memo: { at: number; value: Promise<Sourced<TradeRow[]>> } | null = null;
function allTrades(): Promise<Sourced<TradeRow[]>> {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.value;
  const value = liveOrCache<TradeRow[]>('trades', fetchWindow);
  memo = { at: Date.now(), value };
  value
    .then(v => {
      if (v.source !== 'live') memo = null; // do not pin a fallback; try live again next time
    })
    .catch(e => {
      memo = null;
      console.warn(`[trades] window fetch failed: ${(e as Error).message}`);
    });
  return value;
}

export async function GET(req: Request) {
  const isin = new URL(req.url).searchParams.get('isin') ?? '';
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'isin must be a 12-character ISIN' } }, { status: 400 });
  }
  const t = await allTrades();
  const start = typeof t.meta.start_date === 'string' ? t.meta.start_date : null;
  const end = typeof t.meta.end_date === 'string' ? t.meta.end_date : null;
  const body: TradesPayload = {
    source: t.source,
    fetched_at: t.fetched_at,
    isin,
    window: start && end ? { start_date: start, end_date: end } : null,
    // normalise again: the cache may hold raw rows written by scripts/fetch-upstox-cache.mjs
    trades: (t.data ?? []).map(x => toTrade(x as unknown as Raw)).filter(isTrade).filter(x => x.isin === isin).sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0)),
    ...(t.error ? { error: t.error } : {}),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
