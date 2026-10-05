// Unit tests for the compute engine and the card copy. Fixtures are the worked examples in docs/SPEC.md, the
// cases raised at the Phase 1 gate (CTO/CPO/auditors, PROGRESS.md) and values seen in the real API during
// preflight. Nothing here is used by the app at runtime.
import { describe, expect, it } from 'vitest';
import {
  buyHistory,
  computeIndia,
  computeReentry,
  computeUS,
  defaultTrigger,
  fifoHeld,
  heldQty,
  mtfForOrder,
  mtfMultiplier,
  resolvePrices,
  soldOut,
  todaysTrades,
  usBuyHistory,
  withToday,
} from '@/lib/compute';
import {
  AVG_UNAVAILABLE,
  FOOT_IN_TEXT,
  FOOT_IN_TIP,
  FOOT_REENTRY_TEXT,
  FOOT_US_TEXT,
  FOOT_US_TIP,
  HISTORY_UNAVAILABLE,
  INR_UNAVAILABLE_FILLS,
  INR_UNAVAILABLE_FILLS_ERROR,
  INR_UNAVAILABLE_FX,
  NOT_WIRED,
  NOT_WIRED_NO_CHANGE,
  RECEIPT_LABEL,
  chainPlain,
  indiaCard,
  indiaReceipt,
  plain,
  reentryCard,
  sellReceipt,
  usCard,
  usReceipt,
  type CardModel,
  type Chain,
  type IndiaCardArgs,
  type UsCardArgs,
  type UsLot,
} from '@/lib/copy';
import {
  fmtDate,
  fmtDayMonth,
  fmtExpiry,
  fmtFetched,
  fmtIstClock,
  fmtLastTraded,
  fmtMonthYear,
  initialsOf,
  inr,
  istDate,
  nth,
  num,
  pct,
  qty,
  sgnNum,
  shareCount,
  signedPct,
  usd,
} from '@/lib/format';
import type { OrderResult, TradeRow, UsFill } from '@/lib/types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const T = (trade_date: string, transaction_type: 'BUY' | 'SELL', quantity: number, price: number): TradeRow => ({
  trade_date,
  transaction_type,
  quantity,
  price,
  isin: 'INE982J01020',
  symbol: 'PAYTM',
});
const chainText = (c: Chain | null) => (c === null ? '' : c.kind === 'text' ? c.text : `${chainPlain(c.parts)} | ${c.dates}`);
const notWired: OrderResult = { ok: false, mode: 'not_wired', order_id: null, detail: 'flag off' };
const sandboxOk: OrderResult = { ok: true, mode: 'upstox_sandbox', order_id: '261004130028974', detail: '' };
const H = (quantity: number, average_price: number | null, t1_quantity = 0) => ({ quantity, t1_quantity, average_price });

// SPEC PAYTM example: 6 @ 2,150, buys 2@2460 (12 Jan), 2@2200 (3 Mar), 2@1790 (9 Jun) → avg 2,150.
const PAYTM_TRADES = [T('2026-01-12', 'BUY', 2, 2460), T('2026-03-03', 'BUY', 2, 2200), T('2026-06-09', 'BUY', 2, 1790)];

function card(a: Partial<IndiaCardArgs> & Pick<IndiaCardArgs, 'holding' | 'q' | 'p' | 'ref'>): CardModel {
  const r = indiaCard({ tab: 'regular', symbol: 'PAYTM', history: buyHistory([], 1), windowStart: '2024-04-01', mtfYouPay: null, ...a });
  if (!r) throw new Error('no card');
  return r.model;
}
function us(a: Partial<UsCardArgs> & Pick<UsCardArgs, 'Q' | 'A' | 'lots' | 'q' | 'p' | 'fxNow'>): CardModel {
  const r = usCard({ symbol: 'AAPL', predatesWindow: false, ...a });
  if (!r) throw new Error('no card');
  return r.model;
}
const lot = (date: string, q: number, price: number, fx: number, fxDate: string | null = date.slice(0, 10)): UsLot => ({ date, qty: q, price, fx, fxDate });

describe('format', () => {
  it('formats rupees with Indian grouping and dollars with US grouping', () => {
    expect(inr(1985.3333)).toBe('₹1,985.33');
    expect(inr(4968, 0)).toBe('₹4,968');
    expect(inr(123456.5)).toBe('₹1,23,456.50');
    expect(num(20359.5)).toBe('20,359.50');
    expect(usd(180.30588)).toBe('$180.31');
    expect(usd(1234567.891)).toBe('$1,234,567.89');
  });
  it('never prints a signed zero', () => {
    expect(sgnNum(1367.55)).toBe('+1,367.55');
    expect(sgnNum(-2964)).toBe('-2,964.00');
    expect(sgnNum(-0)).toBe('0.00');
    expect(sgnNum(-0.004)).toBe('0.00');
    expect(num(-0.001)).toBe('0.00');
    expect(inr(-0)).toBe('₹0.00');
    expect(usd(-0.001)).toBe('$0.00');
  });
  it('formats percentages to 1 decimal with a true minus sign', () => {
    expect(pct(-0.29831)).toBe('29.8%');
    expect(signedPct(-0.033498)).toBe('−3.3%');
    expect(signedPct(0.0248)).toBe('+2.5%');
    expect(signedPct(0.00001)).toBe('0.0%');
  });
  it('builds ordinals', () => {
    const want: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th', 112: '112th' };
    for (const [n, s] of Object.entries(want)) expect(nth(Number(n))).toBe(s);
  });
  it('formats quantities and dates (IST)', () => {
    expect(qty(2.4)).toBe('2.4');
    expect(qty(3.4000000001)).toBe('3.4');
    expect(shareCount(1500)).toBe('1500'); // India counts are ungrouped, as in the reference
    expect(fmtDate('2026-01-12')).toBe('12 Jan 2026');
    expect(fmtDate('2026-09-03')).toBe('3 Sep 2026');
    expect(fmtDayMonth('2026-10-02')).toBe('2 Oct');
    expect(fmtMonthYear('2024-04-01')).toBe('Apr 2024');
    // real preflight values
    expect(fmtLastTraded(1790850575180)).toBe('Thu 15:59'); // PAYTM last_trade_time, 1 Oct 2026
    expect(fmtLastTraded(Date.parse('2026-10-02T19:59:59Z'))).toBe('Sat 01:29'); // AAPL IEX last trade, shown as "Sat 01:29 IST"
    expect(fmtExpiry(Date.parse('2026-10-06T18:29:59Z'))).toBe('06 Oct'); // NIFTY next expiry
    expect(fmtFetched('2026-10-04T07:12:49.799Z')).toBe('12:42, 4 Oct');
    expect(istDate(Date.parse('2026-10-05T08:05:00Z'))).toBe('2026-10-05');
    expect(istDate(Date.parse('2026-10-04T19:00:00Z'))).toBe('2026-10-05'); // after IST midnight
    expect(fmtIstClock(Date.parse('2026-10-05T13:30:00Z'))).toBe('Mon 7:00 PM IST');
    expect(initialsOf('ASHA RAO')).toBe('AR');
    expect(initialsOf('ASHA (HUF) RAO')).toBe('AH');
  });
});

describe('computeIndia — SPEC PAYTM example', () => {
  const c = computeIndia({ Q: 6, A: 2150, q: 3, p: 1656, ref: 1656 });
  it('new average, gaps, 10% moves, order value', () => {
    expect(r2(c.newAvg as number)).toBe(1985.33);
    expect(pct(c.gapBefore as number)).toBe('29.8%');
    expect(pct(c.gapAfter as number)).toBe('19.9%');
    expect(inr(c.moveBefore, 0)).toBe('₹994');
    expect(inr(c.moveAfter, 0)).toBe('₹1,490');
    expect(c.orderValue).toBe(4968);
    expect(c.direction).toBe('lowers');
    expect(c.newQty).toBe(9);
  });
  it('produces the exact SPEC card copy', () => {
    const m = card({ holding: H(6, 2150), q: 3, p: 1656, ref: 1656, history: buyHistory(PAYTM_TRADES, 6), windowStart: '2023-04-01' });
    expect(m.title).toBe('After this order');
    expect(plain(m.headerRight)).toBe('Avg ₹2,150.00 → ₹1,985.33');
    expect(m.headerRight[1]).toEqual({ b: '₹1,985.33' });
    expect(plain(m.lead)).toBe('Buying 3 more at ₹1,656.00 lowers your average to ₹1,985.33 and puts ₹4,968 more into PAYTM.');
    expect(m.lead.filter(s => typeof s !== 'string')).toEqual([{ b: '3 more at ₹1,656.00' }, { b: '₹1,985.33' }, { b: '₹4,968' }]);
    expect(m.rows).toEqual([
      { k: 'Shares', before: '6', after: '9' },
      { k: 'Average price', before: '₹2,150.00', after: '₹1,985.33', sub: "Break-even · 19.9% above today's price (was 29.8%)" },
      { k: 'A 10% move is worth', before: '₹994', after: '₹1,490', sub: "How much your money changes each time the price rises or falls 10% — up from ₹994 because you'll hold more shares" },
    ]);
    expect(chainText(m.chain)).toBe('Buys so far: ₹2,460 → ₹2,200 → ₹1,790 → ₹1,656 this order · 4th buy | 12 Jan 2026 · 3 Mar 2026 · 9 Jun 2026 · since Apr 2023');
    expect(m.footer.text).toBe('Based on your holdings and the live NSE price. Charges excluded. Not a recommendation.');
    expect(m.footer.tooltip).toBe('Sources: Upstox Holdings API, Trade history API (last 3 FYs), live NSE price via market data feed. Charges excluded.');
    expect(m.headerSub).toBeNull();
    expect(m.notice).toBeNull();
  });
  it('limit price drives p but not ref; a cleared limit or trigger falls back to the live price', () => {
    expect(resolvePrices({ tab: 'regular', priceMode: 'limit', L: 1656, limit: 1600, trigger: 1500 })).toEqual({ p: 1600, ref: 1656 });
    expect(resolvePrices({ tab: 'regular', priceMode: 'market', L: 1656, limit: 1600, trigger: 1500 })).toEqual({ p: 1656, ref: 1656 });
    expect(resolvePrices({ tab: 'mtf', priceMode: 'market', L: 1656, limit: 1600, trigger: 1500 })).toEqual({ p: 1656, ref: 1656 });
    expect(resolvePrices({ tab: 'regular', priceMode: 'limit', L: 1656, limit: NaN, trigger: 1500 })).toEqual({ p: 1656, ref: 1656 });
    expect(resolvePrices({ tab: 'gtt', priceMode: 'market', L: 1656, limit: null, trigger: 0 })).toEqual({ p: 1656, ref: 1656 });
  });
  it('renders no card without a usable price (never Infinity / NaN)', () => {
    expect(indiaCard({ tab: 'gtt', symbol: 'PAYTM', holding: H(6, 2150), q: 3, p: 0, ref: 0, history: null, windowStart: null, mtfYouPay: null })).toBeNull();
    expect(indiaCard({ tab: 'regular', symbol: 'PAYTM', holding: H(6, 2150), q: 3, p: NaN, ref: 1656, history: null, windowStart: null, mtfYouPay: null })).toBeNull();
  });
});

describe('averaging up (holding in profit)', () => {
  it('flips the verb and the gap wording automatically', () => {
    // TMCV real holding: 15 @ 324.33, LTP 415.50
    const m = card({ symbol: 'TMCV', holding: H(15, 324.33), q: 3, p: 415.5, ref: 415.5, history: buyHistory([], 15) });
    expect(plain(m.lead)).toBe('Buying 3 more at ₹415.50 raises your average to ₹339.53 and puts ₹1,247 more into TMCV.');
    expect(m.rows[1].sub).toBe("Break-even · 18.3% below today's price (was 21.9%)");
    expect(m.rows[2]).toMatchObject({ before: '₹623', after: '₹748' });
  });
  it('names the side of "was" only when the break-even visibly crosses the reference', () => {
    const m = card({ symbol: 'TMCV', holding: H(1, 300), q: 9, p: 600, ref: 415.5 });
    expect(m.rows[1].sub).toBe("Break-even · 37.2% above today's price (was 27.8% below)");
    const z = card({ symbol: 'X', holding: H(6, 100.35), q: 3, p: 100.35, ref: 100.35 });
    expect(plain(z.lead)).toBe('Buying 3 more at ₹100.35 keeps your average at ₹100.35 and puts ₹301 more into PAYTM.'.replace('PAYTM', 'X'));
    expect(z.rows[1].sub).toBe("Break-even · at today's price (was 0.0%)");
  });
  it('names the side of "was" when the new break-even prints "at today\'s price"', () => {
    // real TMCV 15 @ 324.33 at 415.50, a very large order pulls the average to the price
    const m = card({ symbol: 'TMCV', holding: H(15, 324.33), q: 10000, p: 415.5, ref: 415.5 });
    expect(m.rows[1].sub).toBe("Break-even · at today's price (was 21.9% below)");
  });
  it('drops "— up from …" when the 10% figures print the same', () => {
    const m = card({ symbol: 'X', holding: H(6, 2), q: 1, p: 1, ref: 1 });
    expect(m.rows[2]).toEqual({ k: 'A 10% move is worth', before: '₹1', after: '₹1', sub: 'How much your money changes each time the price rises or falls 10%' });
  });
  it('decides the verb on the formatted figures, not on float products (CTO repro)', () => {
    // 324.335 prints "₹324.34" although 324.335 * 100 = 32433.4999…
    const c = computeIndia({ Q: 15, A: 324.33, q: 5, p: 324.35, ref: 415.5 });
    expect(inr(c.newAvg as number)).toBe('₹324.34');
    expect(c.direction).toBe('raises');
    const m = card({ symbol: 'TMCV', holding: H(15, 324.33), q: 5, p: 324.35, ref: 415.5 });
    expect(plain(m.headerRight)).toBe('Avg ₹324.33 → ₹324.34');
    expect(plain(m.lead)).toContain('raises your average to ₹324.34');
    const u = computeUS({ Q: 2, A: 342.29, lots: [], q: 2, p: 342.28, fxNow: 96.3 });
    expect(usd(u.newUsd)).toBe('$342.28');
    expect(u.usdDirection).toBe('down');
  });
  it('renders no card for a stock that is not held (Q = 0 or NaN)', () => {
    for (const quantity of [0, NaN]) {
      expect(indiaCard({ tab: 'regular', symbol: 'X', holding: H(quantity, 2150), q: 3, p: 1656, ref: 1656, history: null, windowStart: null, mtfYouPay: null })).toBeNull();
      expect(usCard({ symbol: 'AAPL', Q: quantity, A: 335, lots: [], predatesWindow: true, q: 1, p: 330, fxNow: 96.3 })).toBeNull();
    }
    expect(indiaCard({ tab: 'regular', symbol: 'X', holding: H(0, 0), q: 3, p: 1656, ref: 1656, history: null, windowStart: null, mtfYouPay: null })).toBeNull();
  });
  it('renders no card for a non-finite order quantity (a 300-digit paste parses to Infinity)', () => {
    for (const q of [Infinity, NaN, -1, 0]) {
      expect(indiaCard({ tab: 'regular', symbol: 'PAYTM', holding: H(6, 2150), q, p: 1656, ref: 1656, history: null, windowStart: null, mtfYouPay: null })).toBeNull();
      expect(usCard({ symbol: 'AAPL', Q: 1, A: 335, lots: [], predatesWindow: true, q, p: 330, fxNow: 96.3 })).toBeNull();
    }
  });
  it('receipts say "stays at" when the printed average does not move', () => {
    const r = indiaReceipt({ tab: 'regular', symbol: 'TMCV', held: H(15, 324.33), q: 3, p: 324.35, L: 415.5, order: notWired });
    expect(r.lines.map(plain)[0]).toBe('Avg stays at ₹324.33');
    expect(r.lines.map(plain)[2]).toBe('Your break-even stays at ₹324.33');
    const u = usReceipt({ symbol: 'AAPL', held: { Q: 1000, A: 100, inrAvg: 9630 }, q: 1, p: 100.01, fxNow: 96.3 });
    expect(u.lines.map(plain)[0]).toBe('$ avg stays at $100.00');
  });
  it('chooses lowers / raises / keeps from the printed values', () => {
    // real TMCV 15 @ 324.33, GTT trigger at the nearest tick 324.35 → the average still prints ₹324.33
    const g = card({ tab: 'gtt', symbol: 'TMCV', holding: H(15, 324.33), q: 3, p: 324.35, ref: 324.35 });
    expect(plain(g.headerRight)).toBe('Avg ₹324.33 → ₹324.33');
    expect(plain(g.lead)).toBe('If this GTT fires, buying 3 at ₹324.35 keeps your average at ₹324.33 and puts ₹973 more into TMCV.');
    expect(computeIndia({ Q: 1000, A: 100, q: 1, p: 100.01, ref: 100 }).direction).toBe('keeps');
  });
});

describe('T1 shares', () => {
  it('Q = quantity + t1_quantity, named in the header subline', () => {
    expect(heldQty({ quantity: 6, t1_quantity: 2 })).toBe(8);
    const r = indiaCard({ tab: 'regular', symbol: 'PAYTM', holding: H(6, 2150, 2), q: 3, p: 1656, ref: 1656, history: buyHistory([], 8), windowStart: '2024-04-01', mtfYouPay: null });
    expect(r?.c.newQty).toBe(11);
    expect(r?.model.rows[0]).toEqual({ k: 'Shares', before: '8', after: '11' });
    expect(r?.model.headerSub).toBe('incl. 2 settling');
    expect(r?.c.newAvg).toBeCloseTo((8 * 2150 + 3 * 1656) / 11, 9);
  });
});

describe('GTT tab', () => {
  it('uses the trigger as both price and reference', () => {
    const { p, ref } = resolvePrices({ tab: 'gtt', priceMode: 'market', L: 1656, limit: 1656, trigger: 1500 });
    const m = card({ tab: 'gtt', holding: H(6, 2150), q: 3, p, ref, history: buyHistory(PAYTM_TRADES, 6), windowStart: '2023-04-01' });
    expect(m.title).toBe('If this GTT fires');
    expect(plain(m.lead)).toBe('If this GTT fires, buying 3 at ₹1,500.00 lowers your average to ₹1,933.33 and puts ₹4,500 more into PAYTM.');
    expect(m.rows[1].sub).toBe('Break-even · 28.9% above the trigger (was 43.3%)');
    expect(m.rows[2]).toMatchObject({ before: '₹900', after: '₹1,350' });
    expect(chainText(m.chain)).toContain('→ ₹1,500 this order · 4th buy');
  });
  it('default trigger = LTP − 0.25 % rounded half-up to tick (Upstox Pro shows 1651.90 for PAYTM 1656)', () => {
    expect(defaultTrigger(1656, 0.1)).toBe(1651.9);
    expect(defaultTrigger(415.5, 0.05)).toBe(414.45);
    expect(defaultTrigger(540, 0.1)).toBe(538.7); // exact half tick rounds up
    expect(defaultTrigger(270, 0.05)).toBe(269.35);
    expect(defaultTrigger(2102, 0.01)).toBe(2096.75);
    expect(defaultTrigger(1656, null)).toBe(1651.86);
  });
});

describe('MTF tab', () => {
  const perShare = 522.7992; // POST /v2/charges/margin, PAYTM 1 @ 1656, product MTF (preflight)
  it('uses the real margin figure and separate-lot copy (CPO wording)', () => {
    const youPay = mtfForOrder(perShare, 1656, 3, 1656) as number;
    expect(r2(youPay)).toBe(1568.4);
    expect(mtfMultiplier(perShare, 1656)).toBe('3.2X');
    const m = card({ tab: 'mtf', holding: H(6, 2150), q: 3, p: 1656, ref: 1656, mtfYouPay: youPay });
    expect(m.title).toBe('After this MTF order');
    expect(plain(m.headerRight)).toBe('Avg ₹2,150.00 → unchanged');
    expect(m.headerRight[1]).toEqual({ b: 'unchanged' });
    expect(plain(m.lead)).toBe(
      'MTF buys are funded separately and leave your delivery average unchanged. This order creates an MTF lot of 3 shares at ₹1,656.00 — you pay ₹1,568, Upstox funds the rest.',
    );
    expect(m.rows).toEqual([
      { k: 'Delivery shares', before: '6 @ ₹2,150', after: 'unchanged' },
      { k: 'MTF lot', before: '—', after: '3 @ ₹1,656', sub: 'interest applies daily' },
      { k: 'All PAYTM shares', before: '6', after: '9', sub: 'blended cost ₹1,985.33' },
    ]);
    expect(m.chain).toBeNull();
    expect(m.footer).toEqual({ text: FOOT_IN_TEXT, tooltip: 'Sources: Upstox Holdings API, Upstox Margin API (MTF), live NSE price via market data feed. Charges excluded.' });
  });
  it('omits the dash clause when the margin is unavailable or zero; helpers refuse bad margins', () => {
    for (const youPay of [null, 0]) {
      const m = card({ tab: 'mtf', holding: H(6, 2150), q: 1, p: 1656, ref: 1656, history: null, windowStart: null, mtfYouPay: youPay });
      expect(plain(m.lead)).toBe('MTF buys are funded separately and leave your delivery average unchanged. This order creates an MTF lot of 1 share at ₹1,656.00.');
    }
    expect(mtfMultiplier(0, 1656)).toBeNull();
    expect(mtfForOrder(0, 1656, 3, 1656)).toBeNull();
    expect(mtfForOrder(NaN, 1656, 3, 1656)).toBeNull();
  });
});

describe('zero trades in the window (real demo account)', () => {
  it('shows the earlier-or-another-way sentence, no Nth buy, rows 1–3 intact', () => {
    const h = buyHistory([], 6);
    expect(h).toEqual({ lots: [], predatesWindow: true, resetOn: null });
    const m = card({ holding: H(6, 2150), q: 3, p: 1656, ref: 1656, history: h, windowStart: '2024-04-01' });
    expect(chainText(m.chain)).toBe('No buys in your Upstox trade history since Apr 2024 — these shares were bought earlier or came another way (IPO, corporate action, transfer).');
    expect(m.rows).toHaveLength(3);
  });
  it('labels unavailable history instead of inventing one', () => {
    const m = card({ holding: H(6, 2150), q: 3, p: 1656, ref: 1656, history: null, windowStart: null });
    expect(chainText(m.chain)).toBe(HISTORY_UNAVAILABLE);
  });
});

describe('average unavailable after a corporate action', () => {
  it('hides rows 2–3, says so, keeps the chain', () => {
    for (const A of [0, null]) {
      const m = card({ symbol: 'TMPV', holding: H(15, A), q: 3, p: 279.4, ref: 279.4, history: buyHistory([], 15) });
      expect(m.rows).toEqual([{ k: 'Shares', before: '15', after: '18' }]);
      expect(m.notice).toBe(AVG_UNAVAILABLE);
      expect(plain(m.headerRight)).toBe('Avg unavailable');
      expect(plain(m.lead)).toBe('Buying 3 more at ₹279.40 puts ₹838 more into TMPV.');
      expect(m.chain).not.toBeNull();
    }
  });
});

describe('buyHistory (net per day, walked back from the current holding)', () => {
  it('keeps every buy when the window explains the whole position', () => {
    const h = buyHistory(PAYTM_TRADES, 6);
    expect(h.lots.map(l => [l.date, l.qty, l.price])).toEqual([['2026-01-12', 2, 2460], ['2026-03-03', 2, 2200], ['2026-06-09', 2, 1790]]);
    expect(h.predatesWindow).toBe(false);
    expect(h.resetOn).toBeNull();
  });
  it('drops buys before the last sale that took the position to zero', () => {
    const trades = [T('2024-05-02', 'BUY', 10, 900), T('2025-01-10', 'SELL', 10, 1100), T('2025-06-01', 'BUY', 4, 700), T('2025-08-01', 'BUY', 2, 650)];
    const h = buyHistory(trades, 6);
    expect(h.lots.map(l => l.date)).toEqual(['2025-06-01', '2025-08-01']);
    expect(h.resetOn).toBe('2025-01-10');
    expect(h.predatesWindow).toBe(false);
  });
  it('nets same-day trades (Indian settlement): sold 5 and bought 3 back the same day keeps the old lot', () => {
    const trades = [T('2025-02-01', 'BUY', 5, 100), T('2025-03-01', 'SELL', 5, 120), T('2025-03-01', 'BUY', 3, 118)];
    const h = buyHistory(trades, 3);
    expect(h.lots).toEqual([{ date: '2025-02-01', qty: 5, price: 100 }]);
    expect(h.resetOn).toBeNull();
  });
  it('an intraday round trip leaves the chain unchanged', () => {
    const h = buyHistory([...PAYTM_TRADES, T('2026-07-01', 'BUY', 10, 1700), T('2026-07-01', 'SELL', 10, 1720)], 6);
    const m = card({ holding: H(6, 2150), q: 3, p: 1656, ref: 1656, history: h, windowStart: '2024-04-01' });
    expect(chainText(m.chain)).toContain('this order · 4th buy');
  });
  it('a net buy day is priced at that day’s buy price', () => {
    const h = buyHistory([T('2026-02-01', 'BUY', 4, 100), T('2026-02-01', 'SELL', 1, 130)], 3);
    expect(h.lots).toEqual([{ date: '2026-02-01', qty: 3, price: 100 }]);
  });
  it('says "at least" when part of the holding predates the window', () => {
    const h = buyHistory([T('2025-03-01', 'SELL', 3, 2400), T('2026-02-01', 'BUY', 1, 2000)], 6);
    expect(h.predatesWindow).toBe(true);
    const m = card({ holding: H(6, 2150), q: 3, p: 1656, ref: 1656, history: h, windowStart: '2024-04-01' });
    expect(chainText(m.chain)).toBe('Buys so far: ₹2,000 → ₹1,656 this order · at least 2nd buy | 1 Feb 2026 · since Apr 2024');
  });
  it('labels a buy of this session "(updated locally)" in the chain; Trade History lots stay unmarked (CPO, Phase 8)', () => {
    const local = { ...T('2026-10-04', 'BUY', 3, 1656), local: true as const };
    const h = buyHistory([T('2026-02-01', 'BUY', 1, 2000), local], 9);
    expect(h.lots).toEqual([{ date: '2026-02-01', qty: 1, price: 2000 }, { date: '2026-10-04', qty: 3, price: 1656, local: true }]);
    const m = card({ holding: H(9, 1985.33), q: 3, p: 1656, ref: 1656, history: h, windowStart: '2024-04-01' });
    expect(chainText(m.chain)).toBe('Buys so far: ₹2,000 → ₹1,656 → ₹1,656 this order · at least 3rd buy | 1 Feb 2026 · 4 Oct 2026 (updated locally) · since Apr 2024');
  });
  it('labels a US lot of this session "(updated locally)"; Alpaca fills stay unmarked', () => {
    const m = us({ Q: 2, A: 334, lots: [lot('2026-10-05T13:30:01Z', 1, 334.5, 96.3), { ...lot('2026-10-05T14:00:00Z', 1, 333.5, 96.3), order_id: 'local' }], q: 1, p: 333.75, fxNow: 96.3 });
    expect(m.chain?.kind === 'buys' ? m.chain.dates : '').toBe('5 Oct 2026 at ₹96.3/$ · 5 Oct 2026 (updated locally) at ₹96.3/$ · today ₹96.3/$');
  });
  it('merges several fills on one day into one quantity-weighted buy', () => {
    const h = buyHistory([T('2026-01-12', 'BUY', 1, 2450), T('2026-01-12', 'BUY', 1, 2470), T('2026-03-03', 'BUY', 4, 2000)], 6);
    expect(h.lots).toEqual([{ date: '2026-01-12', qty: 2, price: 2460 }, { date: '2026-03-03', qty: 4, price: 2000 }]);
  });
  it('only reports a reset for a real sale', () => {
    expect(buyHistory([T('2025-01-01', 'BUY', 5, 100), T('2025-02-01', 'BUY', 3, 90)], 3).resetOn).toBeNull();
  });
});

describe('re-entry (sold out earlier)', () => {
  it('detects the last (net) sale of a stock that is no longer held', () => {
    const trades = [T('2025-07-01', 'BUY', 50, 120), T('2026-03-14', 'SELL', 30, 142), T('2026-03-14', 'SELL', 20, 142.5)];
    expect(soldOut(trades, 0)).toEqual({ date: '2026-03-14', qty: 50, price: 142.2 });
    expect(soldOut(trades, 10)).toBeNull(); // still held → no re-entry card
    expect(soldOut([T('2025-07-01', 'BUY', 5, 100)], 0)).toBeNull(); // never sold
    expect(soldOut([...trades, T('2026-04-01', 'BUY', 1, 90)], 0)).toBeNull(); // bought again later
    expect(soldOut([T('2026-01-02', 'BUY', 10, 100), T('2026-01-02', 'SELL', 10, 101)], 0)).toBeNull(); // intraday only
  });
  it('produces the exact SPEC re-entry copy', () => {
    expect(r2(computeReentry(142.2, 77.06).diff)).toBe(-65.14);
    const m = reentryCard('IRFC', { date: '2026-03-14', qty: 50, price: 142.2 }, 77.06, 1);
    expect(m.title).toBe("You've owned IRFC before");
    expect(plain(m.headerRight)).toBe('Sold at ₹142.20 · now ₹65.14 lower');
    expect(plain(m.lead)).toBe(
      "You sold 50 shares at ₹142.20 on 14 Mar 2026. Today's price ₹77.06 is ₹65.14 lower (−45.8%). This order starts a fresh position of 1 share — there is no old average to blend with.",
    );
    expect(m.footer.text).toBe(FOOT_REENTRY_TEXT);
    expect(m.rows).toHaveLength(0);
  });
  it('uses neutral wording when nothing moved and ungrouped share counts', () => {
    const m = reentryCard('IRFC', { date: '2026-03-14', qty: 1500, price: 77.06 }, 77.06, 2);
    expect(plain(m.headerRight)).toBe('Sold at ₹77.06 · now the same');
    expect(plain(m.lead)).toBe(
      "You sold 1500 shares at ₹77.06 on 14 Mar 2026. Today's price ₹77.06 is the same as your sale price. This order starts a fresh position of 2 shares — there is no old average to blend with.",
    );
  });
});

describe('US — SPEC example (Alpaca paper + Upstox USD INR)', () => {
  const lots = [lot('2026-01-08T15:00:00Z', 1.2, 185, 82.6), lot('2026-05-22T15:00:00Z', 1.2, 179.2, 83.4)];
  const c = computeUS({ Q: 2.4, A: 182.1, lots, q: 1, p: 176, fxNow: 88 });
  it('dollar and rupee averages, returns, fx move', () => {
    const x = c.inr;
    expect(x).not.toBeNull();
    expect(usd(c.newUsd)).toBe('$180.31');
    expect(inr(x!.inrAvg, 0)).toBe('₹15,113');
    expect(inr(x!.newInr, 0)).toBe('₹15,223');
    expect(signedPct(c.rUsd)).toBe('−3.3%');
    expect(signedPct(x!.rInr)).toBe('+2.5%');
    expect(pct(x!.fxMove)).toBe('6.0%');
    expect(num(x!.fxAvg, 1)).toBe('83.0');
    expect(c.usdDirection).toBe('down');
    expect(x!.inrDirection).toBe('up');
  });
  it('produces the SPEC US card copy', () => {
    const m = us({ Q: 2.4, A: 182.1, lots, q: 1, p: 176, fxNow: 88 });
    expect(plain(m.headerRight)).toBe('Avg $182.10 → $180.31');
    expect(plain(m.lead)).toBe(
      'Buying 1 more at $176.00 brings your dollar average down to $180.31 — but your rupee average goes up to ₹15,223, because $1 costs ₹88.0 today vs ₹83.0 when you bought.',
    );
    expect(m.stats).toEqual([
      { label: 'Your return today, in dollars', value: '−3.3%', tone: 'neg' },
      { label: 'Your return today, in rupees', value: '+2.5%', tone: 'pos' },
    ]);
    expect(m.why).toBe('Why they differ: the rupee weakened 6.0% since your buys (₹83.0 → ₹88.0 per $), which adds to your rupee return.');
    expect(m.rows).toEqual([
      { k: 'Shares', before: '2.4', after: '3.4' },
      { k: 'Average price in $', before: '$182.10', after: '$180.31', sub: "Break-even · 2.4% above today's price (was 3.5%)" },
      { k: 'Average price in ₹', before: '₹15,113', after: '₹15,223', sub: 'Up because $1 costs ₹88.0 today vs ₹83.0 at your earlier buys' },
      // SPEC prints ≈ ₹3,718; 0.1 × 2.4 × 176 × 88 = 3,717.12, so the exact figure is ₹3,717 (reference JS agrees).
      { k: 'A 10% move is worth', before: '$42', after: '$60', sub: '≈ ₹3,717 → ₹5,266 · how much your money changes each time the price rises or falls 10%' },
    ]);
    expect(chainText(m.chain)).toBe('Buys so far: $185.00 → $179.20 → $176.00 this order · 3rd buy | 8 Jan 2026 at ₹82.6/$ · 22 May 2026 at ₹83.4/$ · today ₹88.0/$');
    expect(m.footer.text).toBe(FOOT_US_TEXT);
    expect(m.footer.tooltip).toBe(FOOT_US_TIP);
    expect(m.notice).toBeNull();
  });
});

describe('US — FX wording never states a false or empty reason', () => {
  const one = (fx: number, price = 333) => [lot('2026-10-05T08:00:00Z', 1, price, fx)];
  it('same rate at 2 decimals → "the same", no why line', () => {
    const m = us({ Q: 1, A: 333, lots: one(96.3), q: 1, p: 330, fxNow: 96.3 });
    expect(plain(m.lead)).toBe('Buying 1 more at $330.00 brings your dollar average down to $331.50 — and your rupee average goes down to ₹31,923, with $1 at ₹96.3, the same as when you bought.');
    expect(m.why).toBeNull();
    expect(m.rows[2].sub).toBe('Down · $1 costs ₹96.3 today, the same as at your earlier buy');
  });
  it('rates that tie at 1 decimal are printed at 2, and the why line hides at 0.0%', () => {
    const m = us({ Q: 1, A: 333, lots: one(96.3), q: 1, p: 329.14, fxNow: 96.31 });
    expect(plain(m.lead)).toBe('Buying 1 more at $329.14 brings your dollar average down to $331.07 — and your rupee average goes down to ₹31,884, with $1 at ₹96.31 today vs ₹96.30 when you bought.');
    expect(m.why).toBeNull(); // fx move prints 0.0%
    expect(m.rows[2].sub).toBe('Down · $1 costs ₹96.31 today vs ₹96.30 at your earlier buy');
    expect(chainText(m.chain)).toContain('5 Oct 2026 at ₹96.30/$ · today ₹96.31/$');
  });
  it('rupee moves the same way as the dollar while FX moved → no "because"', () => {
    const m = us({ Q: 2, A: 335, lots: [lot('2026-10-05T13:30:00Z', 2, 335, 96.3)], q: 1, p: 330, fxNow: 96.5 });
    expect(plain(m.lead)).toBe('Buying 1 more at $330.00 brings your dollar average down to $333.33 — and your rupee average goes down to ₹32,122, with $1 at ₹96.5 today vs ₹96.3 when you bought.');
    expect(m.rows[2].sub).toBe('Down · $1 costs ₹96.5 today vs ₹96.3 at your earlier buy');
    const up = us({ Q: 2.4, A: 182.1, lots: [lot('2026-01-08T15:00:00Z', 1.2, 185, 82.6), lot('2026-05-22T15:00:00Z', 1.2, 179.2, 83.4)], q: 1, p: 200, fxNow: 80 });
    expect(up.rows[2].sub).toBe('Up · $1 costs ₹80.0 today vs ₹83.0 at your earlier buys');
  });
  it('a 0.0% return tile is not coloured', () => {
    const m = us({ Q: 2, A: 335.4, lots: [lot('2026-10-05T13:30:00Z', 2, 335.4, 96.3)], q: 1, p: 335.38, fxNow: 96.3 });
    expect(m.stats?.map(s => [s.value, s.tone])).toEqual([['0.0%', 'flat'], ['0.0%', 'flat']]);
  });
  it('labels a buy-date rate that fell back to an earlier close', () => {
    const m = us({ Q: 1, A: 333, lots: [lot('2026-10-05T08:00:00Z', 1, 333, 96.3, '2026-10-02')], q: 1, p: 330, fxNow: 96.3 });
    expect(chainText(m.chain)).toContain('5 Oct 2026 at ₹96.3/$ (2 Oct close)');
  });
});

describe('US — rupee side unavailable is labelled, never NaN', () => {
  it('no buy lots / missing FX → $ rows only, notice, no ₹ stat or why', () => {
    const cases: [UsLot[], string][] = [
      [[], INR_UNAVAILABLE_FILLS],
      [[lot('2026-10-05T08:00:00Z', 2, 335, NaN)], INR_UNAVAILABLE_FX],
    ];
    for (const [lots, notice] of cases) {
      const m = us({ Q: 2, A: 335, lots, predatesWindow: true, q: 1, p: 330, fxNow: 96.5 });
      const all = JSON.stringify(m);
      expect(all).not.toMatch(/NaN|Infinity|undefined/);
      expect(m.notice).toBe(notice);
      expect(m.stats).toHaveLength(1);
      expect(m.why).toBeNull();
      expect(m.rows.map(r => r.k)).toEqual(['Shares', 'Average price in $', 'A 10% move is worth']);
      expect(plain(m.lead)).toBe('Buying 1 more at $330.00 brings your dollar average down to $333.33.');
    }
  });
  it('a missing or zero USD/INR today is labelled as an FX problem and never printed', () => {
    for (const fxNow of [NaN, 0]) {
      const m = us({ Q: 2, A: 335, lots: [lot('2026-10-05T08:00:00Z', 2, 335, 96.3)], q: 1, p: 330, fxNow });
      expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity|undefined|₹0\.0\//);
      expect(m.notice).toBe(INR_UNAVAILABLE_FX);
      expect(m.chain?.kind === 'buys' ? m.chain.dates : '').toBe('5 Oct 2026 at ₹96.3/$');
      expect(m.rows[2].sub).toBe('How much your money changes each time the price rises or falls 10%');
    }
  });
  it('lots that cover only part of the position give no ₹ average', () => {
    expect(computeUS({ Q: 3, A: 300, lots: [lot('2026-10-05T08:00:00Z', 1, 300, 96)], q: 1, p: 300, fxNow: 96 }).inr).toBeNull();
  });
  it('after a partial sell the ₹ average uses the shares still held (FIFO)', () => {
    const f = (id: string, o: string, t: string, side: 'buy' | 'sell', q: number, p: number): UsFill => ({ id, order_id: o, transaction_time: t, side, qty: q, price: p });
    const h = usBuyHistory([f('1', 'o1', '2026-01-05T15:00:00Z', 'buy', 1, 100), f('2', 'o2', '2026-02-05T15:00:00Z', 'buy', 1, 200), f('3', 'o3', '2026-03-05T15:00:00Z', 'sell', 1, 210)], 1);
    expect(h.lots.map(l => l.order_id)).toEqual(['o1', 'o2']);
    const fx: Record<string, number> = { o1: 80, o2: 90 };
    const c = computeUS({ Q: 1, A: 200, lots: h.lots.map(l => ({ ...l, fx: fx[l.order_id as string] })), q: 0, p: 205, fxNow: 92 });
    expect(c.inr?.inrAvg).toBe(18000);
    expect(c.inr?.fxAvg).toBe(90);
    expect(fifoHeld([{ qty: 1 }, { qty: 1 }], 1.5)).toEqual([{ qty: 0.5 }, { qty: 1 }]);
    expect(fifoHeld([{ qty: 1 }], 2)).toBeNull();
  });
  it('groups Alpaca fills per order and IST day, oldest first', () => {
    const f = (id: string, o: string, t: string, q: number, p: number): UsFill => ({ id, order_id: o, transaction_time: t, side: 'buy', qty: q, price: p });
    const h = usBuyHistory([f('3', 'o2', '2026-10-05T13:31:00Z', 1, 334), f('1', 'o1', '2026-10-05T08:01:00Z', 0.5, 336), f('2', 'o1', '2026-10-05T08:01:30Z', 0.5, 337)], 2);
    expect(h.lots.map(l => [l.order_id, l.qty, l.price])).toEqual([['o1', 1, 336.5], ['o2', 1, 334]]);
    expect(h.predatesWindow).toBe(false);
    // one order whose fills straddle IST midnight becomes two lots (two buy dates, two FX rates)
    const s = usBuyHistory([f('1', 'o9', '2026-10-05T18:00:00Z', 1, 330), f('2', 'o9', '2026-10-05T19:00:00Z', 1, 331)], 2);
    expect(s.lots).toHaveLength(2);
  });
});

describe('confirmation sheet', () => {
  it('India receipt with a sandbox order id', () => {
    const r = indiaReceipt({ tab: 'regular', symbol: 'PAYTM', held: H(6, 2150), q: 3, p: 1656, L: 1656, order: sandboxOk });
    expect(r.title).toBe('Order placed · PAYTM');
    expect(r.sub).toBe('Buy 3 sh at ₹1,656.00 · Delivery · Sandbox');
    expect(r.label).toBe(RECEIPT_LABEL);
    expect(r.lines.map(plain)).toEqual(['Avg moved ₹2,150.00 → ₹1,985.33', '₹14,904 in PAYTM (9 sh at ₹1,656.00)', 'Your break-even is now ₹1,985.33']);
    expect(r.meta).toBe('Upstox sandbox order 261004130028974. Position updated locally — in production this comes from re-fetching holdings after the fill.');
    expect(r.updatesLocally).toBe(true);
  });
  it('India receipt without placement is the same sheet minus the order id', () => {
    const r = indiaReceipt({ tab: 'regular', symbol: 'PAYTM', held: H(6, 2150), q: 3, p: 1656, L: 1656, order: notWired });
    expect(r.title).toBe('Order placed · PAYTM');
    expect(r.sub).toBe('Buy 3 sh at ₹1,656.00 · Delivery');
    expect(r.lines.map(plain)[0]).toBe('Avg moved ₹2,150.00 → ₹1,985.33');
    expect(r.meta).toBe(NOT_WIRED);
  });
  it('GTT receipt states only what happens if it fires, and changes nothing', () => {
    const g = indiaReceipt({ tab: 'gtt', symbol: 'PAYTM', held: H(6, 2150), q: 3, p: 1500, L: 1656, order: notWired });
    expect(g.title).toBe('GTT placed · PAYTM');
    expect(g.sub).toBe('Buy 3 sh at ₹1,500.00 · Delivery · fires at trigger');
    expect(g.lines.map(plain)).toEqual(['If it fires: avg ₹2,150.00 → ₹1,933.33', '₹13,500 in PAYTM if it fires (9 sh at ₹1,500.00)', 'Your break-even would be ₹1,933.33']);
    expect(g.meta).toBe(NOT_WIRED_NO_CHANGE);
    expect(g.updatesLocally).toBe(false);
  });
  it('MTF receipt keeps the delivery average and does not touch holdings', () => {
    const m = indiaReceipt({ tab: 'mtf', symbol: 'PAYTM', held: H(6, 2150), q: 3, p: 1656, L: 1656, order: notWired });
    expect(m.sub).toBe('Buy 3 sh at ₹1,656.00 · MTF');
    expect(m.lines.map(plain)).toEqual(['Delivery average ₹2,150.00 · unchanged', 'MTF lot 3 sh at ₹1,656.00', '₹14,904 in PAYTM (9 sh at ₹1,656.00)']);
    expect(m.meta).toBe(NOT_WIRED_NO_CHANGE);
    expect(m.updatesLocally).toBe(false);
  });
  it('new-position receipt', () => {
    const n = indiaReceipt({ tab: 'regular', symbol: 'VEDL', held: null, q: 1, p: 252.05, L: 252.05, order: notWired });
    expect(n.lines.map(plain)).toEqual(['New position: 1 sh @ ₹252.05 · ₹252 in VEDL']);
    expect(n.meta).toBe(NOT_WIRED);
    expect(n.updatesLocally).toBe(true);
  });
  it('a holdings row with zero shares is treated as not held on the receipt', () => {
    const r = indiaReceipt({ tab: 'regular', symbol: 'PAYTM', held: H(0, 2150), q: 3, p: 1656, L: 1656, order: notWired });
    expect(r.lines.map(plain)).toEqual(['New position: 3 sh @ ₹1,656.00 · ₹4,968 in PAYTM']);
  });
  it('MTF on a stock not held never claims a position update', () => {
    const n = indiaReceipt({ tab: 'mtf', symbol: 'VEDL', held: null, q: 2, p: 252.05, L: 252.05, order: notWired });
    expect(n.lines.map(plain)).toEqual(['MTF lot 2 sh at ₹252.05 · ₹504 in VEDL']);
    expect(n.meta).toBe(NOT_WIRED_NO_CHANGE);
    expect(n.updatesLocally).toBe(false);
    const s = indiaReceipt({ tab: 'mtf', symbol: 'VEDL', held: null, q: 2, p: 252.05, L: 252.05, order: sandboxOk });
    expect(s.meta).toBe('Upstox sandbox order 261004130028974. In production the MTF lot comes from re-fetching positions after the fill.');
  });
  it('US receipt is never sent (CPO) and says so', () => {
    const r = usReceipt({ symbol: 'AAPL', held: { Q: 2.4, A: 182.1, inrAvg: 15113.14 }, q: 1, p: 176, fxNow: 88 });
    expect(r.sub).toBe('Buy 1 sh at $176.00');
    expect(r.lines.map(plain)).toEqual(['$ avg moved $182.10 → $180.31', '₹ avg moved ₹15,113 → ₹15,223', '₹52,659 in AAPL (3.4 sh)']);
    expect(r.meta).toBe(NOT_WIRED);
    expect(r.updatesLocally).toBe(true);
  });
  it('US receipt with no Alpaca position simulates nothing (SPEC: no simulated position)', () => {
    const r = usReceipt({ symbol: 'AAPL', held: null, q: 1, p: 333.75, fxNow: 96.3 });
    expect(r.lines.map(plain)).toEqual(['If it fills: new position 1 sh @ $333.75 · $333.75 in AAPL']);
    expect(r.meta).toBe(NOT_WIRED_NO_CHANGE);
    expect(r.updatesLocally).toBe(false);
  });
});

describe('fact-only copy (CLAUDE.md rule 4)', () => {
  it('never uses advice words anywhere on the card or the receipt', () => {
    const banned = /\b(avoid|don['’]t|should|risky|safe|opportunity|recover|target|warning)\b/i;
    const texts: string[] = [FOOT_IN_TEXT, FOOT_IN_TIP, FOOT_REENTRY_TEXT, FOOT_US_TEXT, FOOT_US_TIP, AVG_UNAVAILABLE, HISTORY_UNAVAILABLE, INR_UNAVAILABLE_FILLS, INR_UNAVAILABLE_FX, RECEIPT_LABEL, NOT_WIRED, NOT_WIRED_NO_CHANGE];
    const flat = (m: CardModel) => [m.title, m.headerSub ?? '', plain(m.headerRight), plain(m.lead), m.why ?? '', m.notice ?? '', chainText(m.chain), m.footer.text, ...m.rows.flatMap(r => [r.k, r.before, r.after, r.sub ?? '']), ...(m.stats ?? []).map(s => s.label)];
    for (const tab of ['regular', 'gtt', 'mtf'] as const) {
      texts.push(...flat(card({ tab, holding: H(6, 2150, 1), q: 3, p: 1656, ref: 1656, history: buyHistory(PAYTM_TRADES, 6), windowStart: '2023-04-01', mtfYouPay: 1568 })));
      for (const order of [notWired, sandboxOk]) {
        const r = indiaReceipt({ tab, symbol: 'PAYTM', held: H(6, 2150), q: 3, p: 1656, L: 1656, order });
        texts.push(r.title, r.sub, r.meta, ...r.lines.map(plain));
      }
    }
    texts.push(...flat(reentryCard('IRFC', { date: '2026-03-14', qty: 50, price: 142.2 }, 77.06, 1)));
    const fx = [96.3, 96.31, 96.5, 88, 80];
    for (const fxNow of fx) for (const p of [176, 330, 335, 200]) texts.push(...flat(us({ Q: 2, A: 333, lots: [lot('2026-10-05T08:00:00Z', 2, 333, 96.3)], q: 1, p, fxNow })));
    texts.push(...flat(us({ Q: 2, A: 333, lots: [], q: 1, p: 330, fxNow: 96.3 })));
    for (const tab of ['regular', 'gtt', 'mtf'] as const) {
      for (const order of [notWired, sandboxOk]) {
        const r = indiaReceipt({ tab, symbol: 'VEDL', held: null, q: 1, p: 252.05, L: 252.05, order });
        texts.push(r.title, r.sub, r.meta, ...r.lines.map(plain));
      }
    }
    for (const held of [null, { Q: 2.4, A: 182.1, inrAvg: 15113.14 }]) {
      const u = usReceipt({ symbol: 'AAPL', held, q: 1, p: 176, fxNow: 88 });
      texts.push(u.title, u.sub, u.meta, ...u.lines.map(plain));
    }
    texts.push(INR_UNAVAILABLE_FILLS_ERROR);
    for (const t of texts) expect(t).not.toMatch(banned);
  });
});

describe("today's delivery trades (CPO ruling Q1: Holdings + today's executed delivery trades)", () => {
  const TODAY = '2026-10-05';
  const H6 = { quantity: 6, t1_quantity: 0, average_price: 2150, cnc_used_quantity: 0 };
  const card2 = (holding: { quantity: number; t1_quantity: number; average_price: number | null }, today: Parameters<typeof indiaCard>[0]['today'], trades: TradeRow[] = []) =>
    indiaCard({ tab: 'regular', symbol: 'PAYTM', holding, q: 3, p: 1656, ref: 1656, history: buyHistory(trades, heldQty(holding)), windowStart: '2024-04-01', mtfYouPay: null, today })!.model;

  it('net buy: Q = Qh + n, A = (Qh·A + n·p̄)/(Qh + n), a lot dated today, "incl. 3 bought today"', () => {
    const today = [T(TODAY, 'BUY', 1, 1650), T(TODAY, 'BUY', 2, 1660)]; // p̄ = 1656.67
    const r = withToday(H6, today)!;
    expect(heldQty(r.holding)).toBe(9);
    expect(inr(r.holding.average_price as number)).toBe(inr((6 * 2150 + 1650 + 2 * 1660) / 9));
    expect(r.today).toEqual({ bought: 3, sold: 0 });
    const m = card2(r.holding, r.today, today);
    expect(m.headerSub).toBe('incl. 3 bought today');
    expect(plain(m.lead)).toContain('9');
    expect(chainText(m.chain)).toContain('this order · at least 2nd buy');
    expect(chainText(m.chain)).toContain('5 Oct 2026');
  });
  it('net buy with settling shares: "incl. 2 settling, 3 bought today"', () => {
    const r = withToday({ quantity: 4, t1_quantity: 2, average_price: 2150, cnc_used_quantity: 0 }, [T(TODAY, 'BUY', 3, 1656)])!;
    expect(heldQty(r.holding)).toBe(9);
    expect(card2(r.holding, r.today).headerSub).toBe('incl. 2 settling, 3 bought today');
  });
  it('net sell: Q = Qh − min(s, cnc_used_quantity), A unchanged, "after 2 sold today"', () => {
    const r = withToday({ ...H6, cnc_used_quantity: 2 }, [T(TODAY, 'SELL', 2, 1700)])!;
    expect(heldQty(r.holding)).toBe(4);
    expect(r.holding.average_price).toBe(2150);
    expect(r.today).toEqual({ bought: 0, sold: 2 });
    expect(card2(r.holding, r.today).headerSub).toBe('after 2 sold today');
    const t1 = withToday({ quantity: 4, t1_quantity: 2, average_price: 2150, cnc_used_quantity: 2 }, [T(TODAY, 'SELL', 2, 1700)])!;
    expect(card2(t1.holding, t1.today).headerSub).toBe('incl. 2 settling · after 2 sold today');
  });
  it('a sale is never subtracted twice: only up to cnc_used_quantity comes off', () => {
    const r = withToday({ ...H6, cnc_used_quantity: 0 }, [T(TODAY, 'SELL', 2, 1700)])!;
    expect(heldQty(r.holding)).toBe(6);
    expect(r.today).toEqual({ bought: 0, sold: 0 });
  });
  it('selling everything today leaves nothing held (the re-entry card applies)', () => {
    expect(withToday({ ...H6, cnc_used_quantity: 6 }, [T(TODAY, 'SELL', 6, 1700)])).toBeNull();
  });
  it('an intraday round trip in delivery nets to nothing: Q, A and the subline are unchanged', () => {
    const r = withToday(H6, [T(TODAY, 'BUY', 3, 1650), T(TODAY, 'SELL', 3, 1662)])!;
    expect(heldQty(r.holding)).toBe(6);
    expect(r.holding.average_price).toBe(2150);
    expect(r.today).toEqual({ bought: 0, sold: 0 });
    expect(card2(r.holding, r.today).headerSub).toBeNull();
  });
  it('a first buy today of a stock not in Holdings starts the position at that price', () => {
    const r = withToday(null, [T(TODAY, 'BUY', 3, 100)])!;
    expect(r.holding).toEqual({ quantity: 3, t1_quantity: 0, average_price: 100 });
  });
  it('merges only when the trades and the Holdings snapshot were fetched on the same IST day (stale cache)', () => {
    const today = { source: 'live', fetched_at: '2026-10-05T05:00:00Z', trades: [T(TODAY, 'BUY', 3, 1656)] };
    expect(todaysTrades('2026-10-05T04:00:00Z', today, 'INE982J01020')).toHaveLength(1); // same IST day
    expect(todaysTrades('2026-10-04T12:14:23Z', today, 'INE982J01020')).toBe('unavailable'); // holdings from yesterday's cache
    expect(todaysTrades('2026-10-04T12:14:23Z', { ...today, trades: [] }, 'INE982J01020')).toEqual([]); // nothing traded: nothing missing
    expect(todaysTrades('2026-10-05T04:00:00Z', { source: 'unavailable', fetched_at: null, trades: [] }, 'INE982J01020')).toBe('unavailable');
    expect(todaysTrades('2026-10-05T04:00:00Z', today, 'INE1TAE01010')).toEqual([]); // another ISIN
  });
  it("without today's trades the card says so: excl. today's trades (unavailable)", () => {
    expect(card2(H6, 'unavailable').headerSub).toBe("excl. today's trades (unavailable)");
    expect(card2({ quantity: 4, t1_quantity: 2, average_price: 2150 }, 'unavailable').headerSub).toBe("incl. 2 settling · excl. today's trades (unavailable)");
  });
});

describe('sell ticket confirmation (Upstox flow: Sell → exchange → ticket)', () => {
  it('names the side and the exchange, carries no Add-More lines, never updates holdings locally', () => {
    const r = sellReceipt({ tab: 'regular', symbol: 'PAYTM', exchange: 'BSE', q: 1, p: 1664.8, order: sandboxOk });
    expect(r.title).toBe('Order placed · PAYTM');
    expect(r.sub).toBe('Sell 1 sh at ₹1,664.80 · BSE · Delivery · Sandbox');
    expect(r.label).toBeNull();
    expect(r.lines).toEqual([]);
    expect(r.updatesLocally).toBe(false);
    expect(r.meta).toContain('261004130028974');
    const off = sellReceipt({ tab: 'regular', symbol: 'PAYTM', exchange: 'NSE', q: 2, p: 1656, order: notWired });
    expect(off.sub).toBe('Sell 2 sh at ₹1,656.00 · NSE · Delivery');
    expect(off.meta).toBe(NOT_WIRED_NO_CHANGE);
    expect(sellReceipt({ tab: 'gtt', symbol: 'PAYTM', exchange: 'NSE', q: 1, p: 1700, order: notWired }).title).toBe('GTT placed · PAYTM');
  });
});
