import 'server-only';
import type { TradeRow } from '@/lib/types';

// Today's executed trades (GET /v2/order/trades/get-trades-for-day, OAuth) → delivery TradeRows for the card's
// starting position (CPO ruling Q1: Holdings + today's delivery trades). Intraday (I) and MTF trades never change the
// delivery position, so only product D is kept. The rows' own timestamps are not a usable date format; they are
// "today" as of the fetch, so they carry the fetch's IST day.

type Raw = Record<string, unknown>;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function toTodayTrade(t: Raw, date: string): TradeRow | null {
  const side = String(t.transaction_type ?? '').toUpperCase();
  const key = String(t.instrument_token ?? '');
  const isin = key.includes('|') ? key.slice(key.indexOf('|') + 1) : '';
  const row: TradeRow = {
    trade_date: date,
    transaction_type: side === 'SELL' ? 'SELL' : 'BUY',
    price: Number(t.average_price ?? t.price),
    quantity: Number(t.quantity),
    isin,
    symbol: String(t.trading_symbol ?? t.tradingsymbol ?? ''),
    ...(t.trade_id ? { trade_id: String(t.trade_id) } : {}),
  };
  const delivery = String(t.product ?? '').toUpperCase() === 'D';
  if (!delivery || (side !== 'BUY' && side !== 'SELL') || !(row.price > 0) || !(row.quantity > 0) || !ISIN.test(isin)) return null;
  return row;
}
