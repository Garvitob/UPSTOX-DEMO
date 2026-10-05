// The maths of Add-More Check (docs/SPEC.md → Formulas). Pure functions, no I/O, unit-tested in
// tests/compute.test.ts. Every input comes from an API response; nothing here knows any symbol or price.
import { inr as fmtInr, istDate, usd as fmtUsd } from './format';
import type { TradeRow, UsFill } from './types';

export type Tab = 'regular' | 'gtt' | 'mtf';
export type PriceMode = 'market' | 'limit';

const EPS = 1e-9;
const QTY_EPS = 1e-6;
const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Direction of an average, decided on exactly what the card prints (the formatted strings), so the verb can never
 * disagree with the figures next to it ("keeps your average at ₹324.34" under "₹324.33 → ₹324.34" is impossible).
 */
function printedDirection(after: number, before: number, fmt: (n: number) => string): 'down' | 'up' | 'same' {
  if (fmt(after) === fmt(before)) return 'same';
  return after < before ? 'down' : 'up';
}

/** A usable held quantity: finite and > 0. Anything else means "not held" — no card, no simulated position. */
export const heldOk = (Q: number): boolean => pos(Q);

// ---------------------------------------------------------------- India

/** SPEC: Q = quantity + t1_quantity (Upstox Holdings). T1 shares are settling but already owned. */
export function heldQty(h: { quantity: number; t1_quantity: number }): number {
  return (Number(h.quantity) || 0) + (Number(h.t1_quantity) || 0);
}

/**
 * Order price p and reference price ref for the ticket state (SPEC → Inputs). A cleared or zero limit / trigger
 * falls back to the live price, as the reference ticket does (`parseFloat(v) || ltp`).
 */
export function resolvePrices(args: { tab: Tab; priceMode: PriceMode; L: number; limit: number | null; trigger: number | null }): { p: number; ref: number } {
  const limit = pos(args.limit) ? args.limit : args.L;
  const trigger = pos(args.trigger) ? args.trigger : args.L;
  if (args.tab === 'gtt') return { p: trigger, ref: trigger };
  return { p: args.priceMode === 'market' ? args.L : limit, ref: args.L };
}

/** True when p and ref are usable prices (finite and > 0); the card is not rendered otherwise. */
export const pricesUsable = (p: number, ref: number): boolean => pos(p) && pos(ref);

export interface IndiaInput {
  Q: number; // held quantity = quantity + t1_quantity
  A: number | null; // average_price (Upstox Holdings) — null/0 after a corporate action
  q: number; // order quantity
  p: number; // order price
  ref: number; // L, or the trigger on the GTT tab
}

export interface IndiaResult {
  hasAvg: boolean;
  newQty: number;
  newAvg: number | null; // (Q·A + q·p) / (Q + q)
  gapBefore: number | null; // A / ref − 1   (+ ⇒ average above ref)
  gapAfter: number | null; // newAvg / ref − 1
  moveBefore: number; // 0.10 · Q · ref
  moveAfter: number; // 0.10 · (Q + q) · ref
  orderValue: number; // q · p
  direction: 'lowers' | 'raises' | 'keeps' | null; // decided on the printed (paise) values
}

export function computeIndia({ Q, A, q, p, ref }: IndiaInput): IndiaResult {
  const hasAvg = pos(A);
  const newQty = Q + q;
  const newAvg = hasAvg ? (Q * (A as number) + q * p) / newQty : null;
  const d = newAvg === null ? null : printedDirection(newAvg, A as number, n => fmtInr(n));
  const direction = d === null ? null : d === 'down' ? 'lowers' : d === 'up' ? 'raises' : 'keeps';
  return {
    hasAvg,
    newQty,
    newAvg,
    gapBefore: hasAvg ? (A as number) / ref - 1 : null,
    gapAfter: newAvg !== null ? newAvg / ref - 1 : null,
    moveBefore: 0.1 * Q * ref,
    moveAfter: 0.1 * newQty * ref,
    orderValue: q * p,
    direction,
  };
}

// ---------------------------------------------------------------- buy history (shared India / US)

export interface Lot {
  date: string; // India: trade_date "YYYY-MM-DD"; US: ISO time of the lot's first fill
  qty: number;
  price: number; // quantity-weighted average price of the lot
  order_id?: string; // US only ('local' = an order of this session)
  local?: true; // India: the day includes an order of this session (labelled "updated locally" in the chain)
}

interface HistoryEvent {
  date: string;
  local?: true;
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
  order_id?: string;
}

export interface BuyHistory {
  /** Buys since the position was last at zero, oldest first. */
  lots: Lot[];
  /**
   * True when those buys (net of sells) do not explain the whole current holding — part of the position
   * predates the history window or arrived another way (IPO, bonus, demerger, transfer). Copy then says
   * "at least Nth buy", or uses the zero-buys sentence when there are no lots.
   */
  predatesWindow: boolean;
  /** Date of the sale that last took the position to zero inside the window, if any. */
  resetOn: string | null;
}

/**
 * Walks the history backwards from today's holding, so shares bought before the window can never make the
 * position look "sold out". Each event is either a net buy or a net sell.
 */
function walkBack(events: HistoryEvent[], heldQty: number, lotOf: (e: HistoryEvent) => Lot): BuyHistory {
  const lots: Lot[] = [];
  let position = heldQty; // position after the newest event
  let resetOn: string | null = null;
  let reachedZero = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const beforeBuys = position - e.buyQty;
    if (e.buyQty > EPS) lots.push(lotOf(e));
    if (beforeBuys <= QTY_EPS) {
      reachedZero = true;
      if (e.sellQty > EPS) resetOn = e.date;
      else {
        const prev = events[i - 1];
        resetOn = prev && prev.sellQty > EPS ? prev.date : null; // only a real sale "took it to zero"
      }
      break;
    }
    position = beforeBuys + e.sellQty; // position before this event
  }
  lots.reverse();
  return { lots, predatesWindow: !reachedZero, resetOn: reachedZero ? resetOn : null };
}

/**
 * Indian delivery trades of one day settle net: buys and sells on the same trade_date offset each other and
 * Upstox's average only moves by the net. So each day becomes one net buy (priced at that day's
 * quantity-weighted BUY price), one net sell (at the day's weighted SELL price), or nothing.
 */
function netDays(trades: TradeRow[]): HistoryEvent[] {
  const byDate = new Map<string, HistoryEvent>();
  for (const t of trades) {
    if (!pos(t.quantity) || !pos(t.price)) continue;
    const d = t.trade_date.slice(0, 10);
    const e: HistoryEvent = byDate.get(d) ?? { date: d, buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 };
    if (t.local) e.local = true;
    if (t.transaction_type === 'BUY') {
      e.buyQty += t.quantity;
      e.buyValue += t.quantity * t.price;
    } else if (t.transaction_type === 'SELL') {
      e.sellQty += t.quantity;
      e.sellValue += t.quantity * t.price;
    }
    byDate.set(d, e);
  }
  const out: HistoryEvent[] = [];
  for (const e of [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const net = e.buyQty - e.sellQty;
    if (net > QTY_EPS) out.push({ date: e.date, ...(e.local ? { local: true as const } : {}), buyQty: net, buyValue: (net * e.buyValue) / e.buyQty, sellQty: 0, sellValue: 0 });
    else if (net < -QTY_EPS) out.push({ date: e.date, buyQty: 0, buyValue: 0, sellQty: -net, sellValue: (-net * e.sellValue) / e.sellQty });
  }
  return out;
}

// ---------------------------------------------------------------- India: today's executed delivery trades

/** What today's delivery trades did to the starting position (for the header subline). */
export interface TodayInfo {
  bought: number; // today's net delivery buy (0 if none)
  sold: number; // today's net delivery sell taken off Q (0 if none)
}

/**
 * CPO ruling Q1 guards. Today's trades are merged only when they and the Holdings snapshot were fetched on the same
 * IST day (yesterday's trades are already in t1_quantity). Returns this ISIN's delivery trades of that day, or
 * 'unavailable' when they could not be loaded, or when they belong to another day than the Holdings and exist.
 */
export function todaysTrades(
  holdingsFetchedAt: string | null,
  today: { source: string; fetched_at: string | null; trades: TradeRow[] } | null | undefined,
  isin: string | null,
): TradeRow[] | 'unavailable' {
  if (!isin) return [];
  if (!today || today.source === 'unavailable' || !today.fetched_at || !holdingsFetchedAt) return 'unavailable';
  const mine = today.trades.filter(t => t.isin === isin);
  const sameDay = istDate(Date.parse(today.fetched_at)) === istDate(Date.parse(holdingsFetchedAt));
  return sameDay ? mine : mine.length ? 'unavailable' : [];
}

/**
 * CPO ruling Q1: the card starts from Upstox Holdings plus today's executed delivery trades, netted like the history
 * (one net buy or one net sell per day). A net buy n at the day's weighted buy price p̄ gives Q = Qh + n and
 * A = (Qh·A + n·p̄)/(Qh + n). A net sell s takes min(s, cnc_used_quantity) off Q (Holdings keeps shares sold today in
 * `quantity` until settlement and flags them in cnc_used_quantity, so a sale is never subtracted twice), A unchanged.
 * Null when nothing is held afterwards (the re-entry card then applies).
 */
export function withToday(
  h: { quantity: number; t1_quantity: number; average_price: number | null; cnc_used_quantity?: number } | null,
  today: TradeRow[],
): { holding: { quantity: number; t1_quantity: number; average_price: number | null }; today: TodayInfo } | null {
  const qh = h ? heldQty(h) : 0;
  const a0 = h && h.average_price !== null && h.average_price > 0 ? h.average_price : null;
  const day = today[0]?.trade_date ?? '';
  const ev = netDays(today.map(t => ({ ...t, trade_date: day })))[0]; // one day → at most one net event
  let quantity = h ? Number(h.quantity) || 0 : 0;
  let average = a0;
  const info: TodayInfo = { bought: 0, sold: 0 };
  if (ev && ev.buyQty > QTY_EPS) {
    const pBar = ev.buyValue / ev.buyQty;
    info.bought = ev.buyQty;
    average = qh > QTY_EPS ? (a0 !== null ? (qh * a0 + ev.buyQty * pBar) / (qh + ev.buyQty) : null) : pBar;
    quantity += ev.buyQty;
  } else if (ev && ev.sellQty > QTY_EPS && h) {
    info.sold = Math.min(ev.sellQty, Math.max(0, Number(h.cnc_used_quantity) || 0));
    quantity -= info.sold;
  }
  const holding = { quantity, t1_quantity: h ? Number(h.t1_quantity) || 0 : 0, average_price: average };
  return heldOk(heldQty(holding)) ? { holding, today: info } : null;
}

/** India: BUY/SELL rows of one ISIN from Trade History → buys since the position was last flat (one lot per day). */
export function buyHistory(trades: TradeRow[], heldQty: number): BuyHistory {
  return walkBack(netDays(trades), heldQty, e => ({ date: e.date, qty: e.buyQty, price: e.buyValue / e.buyQty, ...(e.local ? { local: true as const } : {}) }));
}

export interface SoldOut {
  date: string;
  qty: number;
  price: number; // quantity-weighted sell price on that date
}

/**
 * Re-entry memory: the last (net) sale of an ISIN that is no longer held. Null when the stock is held, was never
 * sold in the window, or was bought again after the last sale (inconsistent with "not held").
 */
export function soldOut(trades: TradeRow[], heldQty: number): SoldOut | null {
  if (heldQty > EPS) return null;
  const events = netDays(trades);
  let last = -1;
  events.forEach((e, i) => {
    if (e.sellQty > EPS) last = i;
  });
  if (last < 0) return null;
  if (events.slice(last + 1).some(e => e.buyQty > EPS)) return null;
  const e = events[last];
  return { date: e.date, qty: e.sellQty, price: e.sellValue / e.sellQty };
}

export interface ReentryResult {
  diff: number; // L − sold price (negative ⇒ lower now)
  move: number; // L / sold price − 1
}

export function computeReentry(soldPrice: number, L: number): ReentryResult {
  return { diff: L - soldPrice, move: L / soldPrice - 1 };
}

// ---------------------------------------------------------------- US

/**
 * Alpaca fills of one symbol → buy lots since the position was last flat. A lot is one order's fills on one IST
 * calendar day, so every lot has exactly one buy date for its USD/INR rate.
 */
export function usBuyHistory(fills: UsFill[], heldQty: number): BuyHistory {
  const byKey = new Map<string, HistoryEvent>();
  const sorted = fills.filter(f => pos(f.qty) && pos(f.price) && Number.isFinite(Date.parse(f.transaction_time))).sort((a, b) => Date.parse(a.transaction_time) - Date.parse(b.transaction_time));
  for (const f of sorted) {
    const k = `${f.order_id}|${istDate(Date.parse(f.transaction_time))}`;
    const e = byKey.get(k) ?? { date: f.transaction_time, order_id: f.order_id, buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 };
    if (f.side === 'buy') {
      e.buyQty += f.qty;
      e.buyValue += f.qty * f.price;
    } else {
      e.sellQty += f.qty;
      e.sellValue += f.qty * f.price;
    }
    byKey.set(k, e);
  }
  const events = [...byKey.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return walkBack(events, heldQty, e => ({ date: e.date, qty: e.buyQty, price: e.buyValue / e.buyQty, order_id: e.order_id }));
}

export interface UsLotFx {
  qty: number;
  price: number; // $
  fx: number; // ₹ per $ on the buy date (Upstox USD INR daily close)
}

export interface UsInput {
  Q: number; // Alpaca qty
  A: number; // Alpaca avg_entry_price ($)
  lots: UsLotFx[]; // buys since the position was last flat, oldest first
  q: number; // order quantity (fractional allowed)
  p: number; // order price ($, latest trade)
  fxNow: number | null; // ₹ per $ now (Upstox USD INR), null if unavailable
}

/**
 * Keeps only the shares still held, first-in-first-out (oldest lots are consumed by sales first, as Alpaca's
 * avg_entry_price is after its end-of-day sync). Returns null when the lots cover less than the position.
 */
export function fifoHeld<T extends { qty: number }>(lots: T[], Q: number): T[] | null {
  let surplus = lots.reduce((s, l) => s + l.qty, 0) - Q;
  if (surplus < -QTY_EPS) return null;
  const out: T[] = [];
  for (const l of lots) {
    if (surplus > QTY_EPS) {
      const used = Math.min(l.qty, surplus);
      surplus -= used;
      if (l.qty - used > QTY_EPS) out.push({ ...l, qty: l.qty - used });
    } else out.push(l);
  }
  return out;
}

export interface UsInrResult {
  inrAvg: number; // Σ(qty·price·fx) / Σ(qty)
  fxAvg: number; // inrAvg / A
  newInr: number; // (Q·inrAvg + q·p·fxNow) / (Q + q)
  rInr: number; // p·fxNow / inrAvg − 1
  fxMove: number; // fxNow / fxAvg − 1
  moveInrBefore: number; // 0.10 · Q · p · fxNow
  moveInrAfter: number;
  inrDirection: 'down' | 'up' | 'same'; // on printed rupees (0 decimals)
}

export interface UsResult {
  newQty: number;
  newUsd: number; // (Q·A + q·p) / (Q + q)
  rUsd: number; // p / A − 1
  gapBefore: number; // A / p − 1
  gapAfter: number; // newUsd / p − 1
  moveUsdBefore: number; // 0.10 · Q · p
  moveUsdAfter: number; // 0.10 · (Q + q) · p
  usdDirection: 'down' | 'up' | 'same'; // on printed cents
  /** Null when the rupee side cannot be computed honestly (no FX, no buy lots, or lots don't cover the position). */
  inr: UsInrResult | null;
}

export function computeUS({ Q, A, lots, q, p, fxNow }: UsInput): UsResult {
  const newQty = Q + q;
  const newUsd = (Q * A + q * p) / newQty;
  const usdDirection = printedDirection(newUsd, A, n => fmtUsd(n));
  const held = lots.every(l => pos(l.qty) && pos(l.price) && pos(l.fx)) ? fifoHeld(lots, Q) : null;
  const lotQty = held ? held.reduce((s, l) => s + l.qty, 0) : 0;
  let inr: UsInrResult | null = null;
  if (held && held.length > 0 && lotQty > QTY_EPS && pos(fxNow) && pos(A) && pos(p)) {
    const inrAvg = held.reduce((s, l) => s + l.qty * l.price * l.fx, 0) / lotQty;
    const fxAvg = inrAvg / A;
    const newInr = (Q * inrAvg + q * p * fxNow) / newQty;
    inr = {
      inrAvg,
      fxAvg,
      newInr,
      rInr: (p * fxNow) / inrAvg - 1,
      fxMove: fxNow / fxAvg - 1,
      moveInrBefore: 0.1 * Q * p * fxNow,
      moveInrAfter: 0.1 * newQty * p * fxNow,
      inrDirection: printedDirection(newInr, inrAvg, n => fmtInr(n, 0)), // ₹ averages print with 0 decimals on the US card
    };
  }
  return {
    newQty,
    newUsd,
    rUsd: p / A - 1,
    gapBefore: A / p - 1,
    gapAfter: newUsd / p - 1,
    moveUsdBefore: 0.1 * Q * p,
    moveUsdAfter: 0.1 * newQty * p,
    usdDirection,
    inr,
  };
}

// ---------------------------------------------------------------- ticket helpers

/**
 * Upstox's default GTT trigger: last price − 0.25 %, rounded half-up to the instrument's tick size
 * (Upstox Pro shows ₹1,651.90 for PAYTM at ₹1,656.00, tick ₹0.10). Integer paise, so 540 → 538.70 exactly.
 */
export function defaultTrigger(L: number, tick: number | null): number {
  const lp = Math.round(L * 100);
  const tp = tick && tick > 0 ? Math.round(tick * 100) : 1;
  const n = Math.floor((lp * 9975 + tp * 5000) / (tp * 10000));
  return (n * tp) / 100;
}

/**
 * Invested for an Upstox holdings row, as Upstox Pro prints it: (quantity + t1_quantity) × last_price − pnl of the same
 * Holdings snapshot — Upstox's unrounded average (TMCV 15 × 415.50 − 1,367.49 = 4,865.01, not 15 × 324.33 = 4,864.95).
 * Falls back to Q × average_price when the snapshot has no price / pnl; null when neither is usable.
 */
export function holdingInvested(h: { quantity: number; t1_quantity: number; average_price: number | null; last_price?: number | null; pnl?: number | null }): number | null {
  const q = heldQty(h);
  if (!(q > 0)) return null;
  if (typeof h.last_price === 'number' && Number.isFinite(h.last_price) && h.last_price > 0 && typeof h.pnl === 'number' && Number.isFinite(h.pnl)) return q * h.last_price - h.pnl;
  return h.average_price && h.average_price > 0 ? q * h.average_price : null;
}

/**
 * Upstox GTT "Place order · If price is below/above": the trigger at `pctAway` % below/above the last price, rounded
 * half-up to the tick (integer paise). At 0.25 % below this equals defaultTrigger. Null for unusable input.
 */
export function triggerAtPct(L: number, pctAway: number, dir: 'below' | 'above', tick: number | null): number | null {
  if (!(Number.isFinite(L) && L > 0 && Number.isFinite(pctAway) && pctAway >= 0 && pctAway < 100)) return null;
  const tp = tick && tick > 0 ? Math.round(tick * 100) : 1;
  const raw = L * 100 * (dir === 'below' ? 1 - pctAway / 100 : 1 + pctAway / 100);
  const n = Math.floor(raw / tp + 0.5 + 1e-9);
  return n > 0 ? (n * tp) / 100 : null;
}

/**
 * The GTT condition ("If price is below / above") is the user's choice, not a function of the trigger: it changes with
 * the ⌄ toggle, or when a typed trigger lands strictly on the other side of the live price. A trigger equal to the
 * price (e.g. the "0" keystroke of "0.5" in the % box) keeps the current condition (CTO, gate run 2).
 */
export function gttCondition(prev: 'below' | 'above', L: number | null, T: number): 'below' | 'above' {
  if (L === null || !(Number.isFinite(L) && L > 0 && Number.isFinite(T) && T > 0) || T === L) return prev;
  return T < L ? 'below' : 'above';
}

/** The price a Market ticket asks the Margin API at: sampled from the live LTP for one order (`id`). */
export interface MarketSample {
  id: string; // the order as the user set it: instrument | quantity | side | product | tab | price mode
  p: number; // price of the current sample
  prev: number | null; // the previous sample of the same order (its answer stays valid while the next one loads)
  at: number; // when the current sample was taken (epoch ms)
}

/**
 * One step of the Market-order price sampling (CPO, gate run 3 follow-up: a tick is not a change to the order).
 * A new order takes the live price at once (delay 0, no previous sample). The same order at the same price needs nothing
 * (null). A moved price is sampled at the deadline `at + refreshMs` — ticks never move the deadline, so the Margin API is
 * asked at most once per refreshMs — and the sample it replaces becomes `prev`.
 */
export function marketSampleStep(cur: MarketSample | null, id: string, pNow: number, now: number, refreshMs: number): { delayMs: number; next: (at: number) => MarketSample } | null {
  if (!cur || cur.id !== id) return { delayMs: 0, next: at => ({ id, p: pNow, prev: null, at }) };
  if (pNow === cur.p) return null;
  return { delayMs: Math.max(0, refreshMs - (now - cur.at)), next: at => ({ id, p: pNow, prev: cur.p, at }) };
}

/**
 * Required for the order on screen, from the Margin API's latest answer: only an answer for the same instrument,
 * quantity, side and product counts. On a Market order it may be at the current or the previous sample; otherwise
 * (Limit, GTT) it must be at the price the box shows. Null = "—".
 */
export function marginAnswerFor(
  rm: { instrument_key: string; quantity: number; side: string; product: string; price: number; required_margin: number | null } | null,
  order: { key: string | null; q: number; side: string; product: string },
  price: { sample: MarketSample | null; pNow: number | null },
): number | null {
  if (!rm || rm.instrument_key !== order.key || rm.quantity !== order.q || rm.side !== order.side || rm.product !== order.product) return null;
  if (price.pNow === null) return null;
  const ok = price.sample ? rm.price === price.sample.p || rm.price === price.sample.prev : rm.price === price.pNow;
  return ok ? rm.required_margin : null;
}

/**
 * A US lot bought today has no daily USD/INR close yet, so it uses today's live rate — the same rate the card prints as
 * "today", never an older reading of it (CPO + CTO, US-card gate). Lots with a dated close keep it. No live rate → NaN,
 * which the card turns into its labelled "rupee average unavailable" notice.
 */
export function lotsAtLiveRate<T extends { fx: number; fxLive?: boolean }>(lots: T[], fxNow: number | null): T[] {
  return lots.map(l => (l.fxLive ? { ...l, fx: fxNow ?? NaN } : l));
}

/** A typed US quantity is reviewable when it is fractional ≥ 0.1 share (SPEC Inputs) and within the input cap. */
export function usQtyValid(text: string, max: number): boolean {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n >= 0.1 && n <= max;
}

/** Tick size of the exchange a ticket trades on: a BSE ticket on a dual-listed stock uses the BSE listing's tick. */
export function tickFor(info: { tick_size: number | null; bse_key: string | null; bse_tick_size?: number | null } | null, exchange: 'NSE' | 'BSE'): number | null {
  if (!info) return null;
  return (exchange === 'BSE' && info.bse_key ? info.bse_tick_size ?? info.tick_size : info.tick_size) ?? null;
}

/** The trigger's distance from the last price in % (the box beside the trigger), and on which side it sits. */
export function pctFromTrigger(L: number, T: number): { pct: number; dir: 'below' | 'above' } | null {
  if (!(Number.isFinite(L) && L > 0 && Number.isFinite(T) && T > 0)) return null;
  return { pct: (Math.abs(L - T) / L) * 100, dir: T <= L ? 'below' : 'above' };
}

/** MTF margin for an order, scaled from the per-share margin the Margin API returned at `atPrice`. Null if unusable. */
export function mtfForOrder(perShareMargin: number, atPrice: number, q: number, p: number): number | null {
  // Upstox MTF margin is a fixed fraction of order value (522.7992 / 1656 = 0.3157 for PAYTM; Upstox Pro's
  // "With MTF: ₹521.50" at ₹1,651.90 confirms the same ratio).
  if (!pos(perShareMargin) || !pos(atPrice) || !pos(q) || !pos(p)) return null;
  return (perShareMargin / atPrice) * q * p;
}

/** "3.2X" multiplier shown on the MTF badge: price / per-share MTF margin, 1 decimal. Null if unusable. */
export function mtfMultiplier(perShareMargin: number, atPrice: number): string | null {
  if (!pos(perShareMargin) || !pos(atPrice)) return null;
  return (atPrice / perShareMargin).toFixed(1) + 'X';
}
