// Final-gate fixes (2026-10-05): Invested as Upstox prints it, the GTT trigger ⇄ % boxes, exchange-aware card footer /
// receipts, and the US sell sheet. Fixtures are the real values from the human's pro.upstox.com screenshots and
// data/cache/holdings.json (TMCV 15 @ 324.33, last 415.50, pnl 1,367.49; TMPV 15 @ 716.87, last 279.40, pnl −6,561.99).
import { describe, expect, it } from 'vitest';
import { defaultTrigger, holdingInvested, pctFromTrigger, triggerAtPct } from '@/lib/compute';
import { FOOT_IN_TEXT, footInText, footInTip, footMtfTip, indiaCard, indiaReceipt, plain, usSellReceipt } from '@/lib/copy';
import { num } from '@/lib/format';
import type { OrderResult } from '@/lib/types';

const H = (quantity: number, average_price: number, last_price?: number, pnl?: number) => ({ quantity, t1_quantity: 0, average_price, last_price, pnl });
const notWired: OrderResult = { ok: false, mode: 'not_wired', order_id: null, detail: 'flag off' };

describe('Invested (Upstox Pro holdings column)', () => {
  it('is quantity × last_price − pnl of the Holdings snapshot, as Upstox prints it', () => {
    expect(num(holdingInvested(H(15, 324.33, 415.5, 1367.49)) as number)).toBe('4,865.01');
    expect(num(holdingInvested(H(15, 716.87, 279.4, -6561.99)) as number)).toBe('10,752.99');
    expect(num(holdingInvested(H(6, 2150, 1656, -2964)) as number)).toBe('12,900.00');
  });
  it('sums to the summary Invested 28,518.00 (= Upstox)', () => {
    const t = [H(6, 2150, 1656, -2964), H(15, 324.33, 415.5, 1367.49), H(15, 716.87, 279.4, -6561.99)].reduce((s, h) => s + (holdingInvested(h) as number), 0);
    expect(num(t)).toBe('28,518.00');
  });
  it('falls back to Q × average without a snapshot price / pnl, and is null when nothing is usable', () => {
    expect(holdingInvested(H(6, 2150))).toBe(12900);
    expect(holdingInvested(H(6, 0))).toBeNull();
    expect(holdingInvested(H(0, 2150, 1656, 0))).toBeNull();
    expect(holdingInvested({ quantity: 4, t1_quantity: 2, average_price: 100, last_price: 110, pnl: 60 })).toBe(600);
  });
});

describe('GTT trigger ⇄ %', () => {
  it('0.25 % below the live price is the Upstox default trigger', () => {
    expect(triggerAtPct(1656, 0.25, 'below', 0.1)).toBe(1651.9);
    expect(triggerAtPct(1656, 0.25, 'below', 0.1)).toBe(defaultTrigger(1656, 0.1));
    expect(triggerAtPct(540, 0.25, 'below', 0.05)).toBe(defaultTrigger(540, 0.05));
  });
  it('the % box shows the distance of the trigger from the live price', () => {
    expect(pctFromTrigger(1656, 1651.9)?.pct.toFixed(2)).toBe('0.25');
    expect(pctFromTrigger(1656, 1651.9)?.dir).toBe('below');
    expect(pctFromTrigger(1656, 1500)?.pct.toFixed(2)).toBe('9.42');
    expect(pctFromTrigger(1656, 1700)?.dir).toBe('above');
  });
  it('above mirrors below on the tick grid; bad input gives null', () => {
    expect(triggerAtPct(1656, 0.25, 'above', 0.1)).toBe(1660.1);
    expect(triggerAtPct(1656, NaN, 'below', 0.1)).toBeNull();
    expect(triggerAtPct(0, 1, 'below', 0.1)).toBeNull();
    expect(triggerAtPct(1656, 100, 'below', 0.1)).toBeNull();
    expect(pctFromTrigger(1656, 0)).toBeNull();
  });
});

describe('exchange named on the card and the receipt', () => {
  it('the footer and tooltips name the picked exchange (NSE stays the SPEC text)', () => {
    expect(FOOT_IN_TEXT).toBe('Based on your holdings and the live NSE price. Charges excluded. Not a recommendation.');
    expect(footInText('BSE')).toBe('Based on your holdings and the live BSE price. Charges excluded. Not a recommendation.');
    expect(footInTip('BSE')).toContain('live BSE price via market data feed');
    expect(footMtfTip('BSE')).toContain('live BSE price via market data feed');
  });
  it('a BSE-priced card carries the BSE footer on every tab', () => {
    for (const tab of ['regular', 'gtt', 'mtf'] as const) {
      const r = indiaCard({ tab, symbol: 'PAYTM', holding: H(6, 2150), q: 1, p: 1664.8, ref: 1664.8, history: null, windowStart: null, mtfYouPay: 525.58, exchange: 'BSE' });
      expect(r?.model.footer.text).toBe(footInText('BSE'));
    }
  });
  it('the buy receipt sub names the exchange like the sell sheet', () => {
    const r = indiaReceipt({ tab: 'gtt', symbol: 'PAYTM', held: H(6, 2150), q: 1, p: 1500, L: 1656, order: notWired, exchange: 'NSE' });
    expect(r.sub).toBe('Buy 1 sh at ₹1,500.00 · NSE · Delivery · fires at trigger');
    expect(plain(r.lines[0])).toBe('If it fires: avg ₹2,150.00 → ₹2,057.14');
  });
});

describe('US sell sheet', () => {
  it('is never sent and has no Add-More lines', () => {
    const r = usSellReceipt({ symbol: 'AAPL', q: 1, p: 333.75 });
    expect(r).toMatchObject({ title: 'Order placed · AAPL', sub: 'Sell 1 sh at $333.75', label: null, lines: [], meta: 'Order placement not wired in this demo.', updatesLocally: false });
  });
});

describe('US lot bought today (gate run 2, CTO note)', () => {
  it('a same-day fill priced at the live USD/INR says so in the chain', async () => {
    const { usCard } = await import('@/lib/copy');
    const today = { date: '2026-10-05T14:00:00Z', qty: 1, price: 333.75, fx: 96.3, fxDate: '2026-10-05', fxLive: true };
    const r = usCard({ symbol: 'AAPL', Q: 1, A: 333.75, lots: [today], predatesWindow: false, q: 1, p: 333.75, fxNow: 96.3 });
    expect(JSON.stringify(r?.model.chain)).toContain('5 Oct 2026 at ₹96.3/$ (live rate until the day closes) · today ₹96.3/$');
    const closed = usCard({ symbol: 'AAPL', Q: 1, A: 333.75, lots: [{ ...today, fxLive: false }], predatesWindow: false, q: 1, p: 333.75, fxNow: 96.3 });
    expect(JSON.stringify(closed?.model.chain)).not.toContain('live rate until the day closes');
  });
});

describe('GTT condition and tick (CTO, gate run 2)', () => {
  it('the condition is kept while a typed % passes through the live price ("0" of "0.5")', async () => {
    const { gttCondition } = await import('@/lib/compute');
    expect(gttCondition('above', 1656, 1656)).toBe('above'); // "0" → trigger = LTP: keep "above"
    expect(triggerAtPct(1656, 0.5, 'above', 0.1)).toBe(1664.3); // "0.5" while above stays above
    expect(gttCondition('above', 1656, 1664.3)).toBe('above');
    expect(gttCondition('below', 1656, 1700)).toBe('above'); // a typed trigger strictly above moves it
    expect(gttCondition('above', 1656, 1500)).toBe('below');
    expect(gttCondition('below', null, 1500)).toBe('below');
    expect(gttCondition('above', 1656, NaN)).toBe('above');
  });
  it('a BSE ticket rounds on the BSE listing’s tick', async () => {
    const { tickFor } = await import('@/lib/compute');
    const paytm = { tick_size: 0.1, bse_key: 'BSE_EQ|INE982J01020', bse_tick_size: 0.05 }; // instrument master values
    expect(tickFor(paytm, 'NSE')).toBe(0.1);
    expect(tickFor(paytm, 'BSE')).toBe(0.05);
    expect(defaultTrigger(1664.8, tickFor(paytm, 'BSE'))).toBe(1660.65);
    expect(defaultTrigger(1656, tickFor(paytm, 'NSE'))).toBe(1651.9);
    expect(tickFor({ tick_size: 0.05, bse_key: null }, 'BSE')).toBe(0.05); // listed on one exchange only
    expect(tickFor({ tick_size: 0.01, bse_key: 'BSE_EQ|INE415G01027', bse_tick_size: null }, 'BSE')).toBe(0.01);
    expect(tickFor(null, 'NSE')).toBeNull();
  });
});

describe('US quantity (CPO, gate run 3)', () => {
  it('reviewable only when fractional ≥ 0.1 and within the cap — the bounds the order quantity is clamped to', async () => {
    const { usQtyValid } = await import('@/lib/compute');
    expect(usQtyValid('0.05', 999_999)).toBe(false); // would have become a 0.1-share receipt nobody typed
    expect(usQtyValid('0.1', 999_999)).toBe(true);
    expect(usQtyValid('1.5', 999_999)).toBe(true);
    expect(usQtyValid('', 999_999)).toBe(false);
    expect(usQtyValid('.', 999_999)).toBe(false);
    expect(usQtyValid('1000000', 999_999)).toBe(false);
  });
});

describe('Market order: a tick is not a change to the order (CPO, gate run 3 follow-up)', () => {
  const ORDER = 'NSE_EQ|INE982J01020|1|BUY|D|regular|market';
  it('a new order is sampled at once; the same price needs nothing', async () => {
    const { marketSampleStep } = await import('@/lib/compute');
    const first = marketSampleStep(null, ORDER, 1656, 1_000, 5_000);
    expect(first?.delayMs).toBe(0);
    expect(first?.next(1_000)).toEqual({ id: ORDER, p: 1656, prev: null, at: 1_000 });
    expect(marketSampleStep({ id: ORDER, p: 1656, prev: null, at: 1_000 }, ORDER, 1656, 3_000, 5_000)).toBeNull();
  });
  it('a tick before the deadline does not change the request: it is sampled at the fixed deadline', async () => {
    const { marketSampleStep } = await import('@/lib/compute');
    const cur = { id: ORDER, p: 1656, prev: null, at: 1_000 };
    expect(marketSampleStep(cur, ORDER, 1656.1, 2_000, 5_000)?.delayMs).toBe(4_000); // 1 s after the sample → wait 4 s
    expect(marketSampleStep(cur, ORDER, 1655.9, 5_800, 5_000)?.delayMs).toBe(200); // later ticks keep the same deadline
    expect(marketSampleStep(cur, ORDER, 1657, 9_000, 5_000)?.delayMs).toBe(0); // deadline already passed
    expect(marketSampleStep(cur, ORDER, 1657, 9_000, 5_000)?.next(9_000)).toEqual({ id: ORDER, p: 1657, prev: 1656, at: 9_000 });
  });
  it('a change the user makes is a new order, sampled at once', async () => {
    const { marketSampleStep } = await import('@/lib/compute');
    const cur = { id: ORDER, p: 1656, prev: 1655.9, at: 1_000 };
    const qty2 = marketSampleStep(cur, ORDER.replace('|1|', '|2|'), 1656.1, 1_500, 5_000);
    expect(qty2?.delayMs).toBe(0);
    expect(qty2?.next(1_500).prev).toBeNull(); // the old order's answers never carry over
  });
  it('only an answer for the same instrument, quantity, side and product counts — at the current or previous sample', async () => {
    const { marginAnswerFor } = await import('@/lib/compute');
    const order = { key: 'NSE_EQ|INE982J01020', q: 1, side: 'BUY', product: 'D' };
    const sample = { id: ORDER, p: 1656.1, prev: 1656, at: 6_000 };
    const ans = (o: Partial<{ instrument_key: string; quantity: number; side: string; product: string; price: number }>) => ({ instrument_key: order.key, quantity: 1, side: 'BUY', product: 'D', price: 1656, required_margin: 1656, ...o });
    expect(marginAnswerFor(ans({}), order, { sample, pNow: 1656.4 })).toBe(1656); // previous sample still shown while the next loads
    expect(marginAnswerFor(ans({ price: 1656.1, required_margin: 1656.1 } as never), order, { sample, pNow: 1656.4 })).toBe(1656.1);
    expect(marginAnswerFor(ans({ price: 1655 }), order, { sample, pNow: 1656.4 })).toBeNull(); // an older sample does not count
    expect(marginAnswerFor(ans({ quantity: 2 }), order, { sample, pNow: 1656 })).toBeNull();
    expect(marginAnswerFor(ans({ side: 'SELL' }), order, { sample, pNow: 1656 })).toBeNull();
    expect(marginAnswerFor(ans({ product: 'MTF' }), order, { sample, pNow: 1656 })).toBeNull();
    expect(marginAnswerFor(ans({ instrument_key: 'BSE_EQ|INE982J01020' }), order, { sample, pNow: 1656 })).toBeNull();
    // Limit / GTT (no sample): only the price the box shows counts
    expect(marginAnswerFor(ans({ price: 1500, required_margin: 1500 } as never), order, { sample: null, pNow: 1500 })).toBe(1500);
    expect(marginAnswerFor(ans({}), order, { sample: null, pNow: 1500 })).toBeNull();
    expect(marginAnswerFor(null, order, { sample: null, pNow: 1500 })).toBeNull();
  });
});

describe('US lot bought today follows the live rate (CPO + CTO, US-card gate)', () => {
  it('one live rate on the card: the lot takes today\'s rate, so "the same as when you bought" and both returns agree', async () => {
    const { lotsAtLiveRate, computeUS } = await import('@/lib/compute');
    const { usCard, plain } = await import('@/lib/copy');
    const fetched = [{ date: '2026-10-05T00:00:12Z', qty: 1, price: 333.47, fx: 96.3, fxDate: '2026-10-05', fxLive: true }]; // dated payload 96.30 (feed)
    const lots = lotsAtLiveRate(fetched, 96.27); // today's rate has ticked to 96.27
    expect(lots[0].fx).toBe(96.27);
    const c = computeUS({ Q: 1, A: 333.47, lots, q: 1, p: 333.75, fxNow: 96.27 });
    expect(c.inr?.rInr).toBeCloseTo(c.rUsd, 12);
    const m = usCard({ symbol: 'AAPL', Q: 1, A: 333.47, lots, predatesWindow: false, q: 1, p: 333.75, fxNow: 96.27 });
    expect(plain(m!.model.lead)).toContain('the same as when you bought');
    expect(m!.model.why).toBeNull();
    expect(JSON.stringify(m!.model.chain)).toContain('at ₹96.3/$ (live rate until the day closes) · today ₹96.3/$'); // identical rates print at 1 decimal (CPO Q2)
    // a lot with a dated close keeps it; no live rate → NaN (labelled unavailable)
    expect(lotsAtLiveRate([{ fx: 83.4, fxLive: false }], 96.27)[0].fx).toBe(83.4);
    expect(Number.isNaN(lotsAtLiveRate([{ fx: 96.3, fxLive: true }], null)[0].fx)).toBe(true);
  });
});
