// Every string on the Add-More Check card and its receipt, built from compute outputs (docs/SPEC.md → Card copy,
// plus the CPO rulings recorded in PROGRESS.md). Strings are returned as segments ({ b } = bold, { arrow } = the
// grey "→") so React renders them without raw HTML and tests assert exactly what the UI shows. Fact-only: no
// advice words, no colour judgements (except the US return pair, which mirrors Upstox P&L colouring per SPEC).
import {
  computeIndia,
  computeReentry,
  computeUS,
  heldOk,
  heldQty,
  pricesUsable,
  type BuyHistory,
  type IndiaResult,
  type Lot,
  type SoldOut,
  type Tab,
  type TodayInfo,
  type UsResult,
} from './compute';
import { fmtDate, fmtDayMonth, fmtMonthYear, inr, istDate, nth, num, pct, qty, shareCount, shares, signedPct, usd } from './format';
import type { OrderResult } from './types';

export type Seg = string | { b: string };
export type ChainPart = Seg | { arrow: true };
export const plain = (segs: Seg[]): string => segs.map(s => (typeof s === 'string' ? s : s.b)).join('').replace(/\u00a0/g, ' ');
export const chainPlain = (parts: ChainPart[]): string => parts.map(p => (typeof p === 'string' ? p : 'b' in p ? p.b : ' → ')).join('').replace(/\u00a0/g, ' ');

export interface KvRow {
  k: string;
  before: string;
  after: string;
  sub?: string;
}

export type Chain = { kind: 'buys'; parts: ChainPart[]; dates: string } | { kind: 'text'; text: string };

export interface CardModel {
  variant: 'regular' | 'gtt' | 'mtf' | 'reentry' | 'us';
  title: string;
  headerSub: string | null;
  headerRight: Seg[];
  lead: Seg[];
  stats: { label: string; value: string; tone: 'neg' | 'pos' | 'flat' }[] | null;
  why: string | null;
  rows: KvRow[];
  notice: string | null;
  chain: Chain | null;
  footer: { text: string; tooltip: string };
}

// ---------------------------------------------------------------- fixed strings (SPEC wording)
// The India footer and tooltips name the exchange the ticket trades on (SPEC wrote NSE; a BSE ticket is priced on BSE).
export type Exch = 'NSE' | 'BSE';
export const footInText = (ex: Exch) => `Based on your holdings and the live ${ex} price. Charges excluded. Not a recommendation.`;
export const footInTip = (ex: Exch) => `Sources: Upstox Holdings API, Trade history API (last 3 FYs), live ${ex} price via market data feed. Charges excluded.`;
export const footMtfTip = (ex: Exch) => `Sources: Upstox Holdings API, Upstox Margin API (MTF), live ${ex} price via market data feed. Charges excluded.`;
export const FOOT_IN_TEXT = footInText('NSE');
export const FOOT_REENTRY_TEXT = 'From your trade history (last 3 financial years). Not a recommendation.';
export const FOOT_US_TEXT = '₹ figures use daily USD/INR reference rates on your buy dates. Not a recommendation.';
export const FOOT_IN_TIP = footInTip('NSE');
export const FOOT_MTF_TIP = footMtfTip('NSE');
export const FOOT_US_TIP =
  'Sources: Alpaca positions & fills (paper), USD/INR live from Upstox global indicator. ₹ figures use daily reference rates on your buy dates, not the rate applied to your transfer.';
export const AVG_UNAVAILABLE = "Average unavailable after a corporate action. We won't estimate it.";
export const HISTORY_UNAVAILABLE = 'Buy history unavailable — Upstox trade history could not be loaded.';
export const INR_UNAVAILABLE_FILLS = "Rupee average unavailable — the Alpaca fills cover only part of this position. We won't estimate it.";
export const INR_UNAVAILABLE_FX = "Rupee average unavailable — USD/INR could not be loaded from Upstox. We won't estimate it.";
export const INR_UNAVAILABLE_FILLS_ERROR = "Rupee average unavailable — Alpaca fills could not be loaded. We won't estimate it.";
const TEN_PCT = 'How much your money changes each time the price rises or falls 10%';
export const RECEIPT_LABEL = 'Add-More Check · receipt';
export const NOT_WIRED = 'Order placement not wired in this demo. Position updated locally.';
export const NOT_WIRED_NO_CHANGE = 'Order placement not wired in this demo.';
/** After a buy date in the chain when that buy is an order of this session, not a Trade History / Alpaca fill. */
export const LOCAL_LOT = ' (updated locally)';

const TITLES: Record<Tab, string> = { regular: 'After this order', gtt: 'If this GTT fires', mtf: 'After this MTF order' };

// ---------------------------------------------------------------- shared phrases

/** "19.9% above today's price" / "3.1% below the trigger" / "at today's price" when it rounds to 0.0%. */
export function gapWords(gap: number, refName: string): string {
  const s = pct(gap);
  return s === '0.0%' ? `at ${refName}` : `${s} ${gap >= 0 ? 'above' : 'below'} ${refName}`;
}

/**
 * "Break-even · 19.9% above today's price (was 29.8%)". The "was" figure names its side when the reader could not
 * otherwise tell it: the break-even visibly crossed the reference, or the new gap prints "at today's price".
 */
export function breakEvenLine(gapAfter: number, gapBefore: number, refName: string): string {
  const zeroA = pct(gapAfter) === '0.0%';
  const zeroB = pct(gapBefore) === '0.0%';
  const named = !zeroB && (zeroA || gapAfter >= 0 !== gapBefore >= 0);
  return `Break-even · ${gapWords(gapAfter, refName)} (was ${pct(gapBefore)}${named ? (gapBefore >= 0 ? ' above' : ' below') : ''})`;
}

/** Chain row: "Buys so far: ₹2,460 → ₹2,200 → ₹1,656 this order · 3rd buy" + dates underneath. */
function chainFromLots(lots: Lot[], predates: boolean, priceFmt: (n: number) => string, current: number, dates: string): Chain {
  const parts: ChainPart[] = ['Buys so far: '];
  for (const l of lots) parts.push({ b: priceFmt(l.price) }, { arrow: true });
  parts.push({ b: priceFmt(current) }, ` this order · ${predates ? 'at least ' : ''}${nth(lots.length + 1)}\u00a0buy`);
  return { kind: 'buys', parts, dates };
}

// ---------------------------------------------------------------- India: Regular / GTT / MTF

export interface IndiaCardArgs {
  tab: Tab;
  symbol: string;
  holding: { quantity: number; t1_quantity: number; average_price: number | null }; // Upstox Holdings fields
  q: number;
  p: number;
  ref: number;
  history: BuyHistory | null; // null ⇒ trade history unavailable
  windowStart: string | null; // start_date used for the trade-history call
  mtfYouPay: number | null; // MTF margin for this order from the Margin API, null if not available
  /** Today's executed delivery trades already merged into `holding` (CPO Q1), or 'unavailable' when they could not be loaded. */
  today?: TodayInfo | 'unavailable' | null;
  /** The exchange whose live price the ticket uses (default NSE). */
  exchange?: Exch;
}

/**
 * Null when there is nothing honest to show: no usable price yet (no live price, cleared input) or no shares held
 * (quantity + t1_quantity not > 0) — the ticket is then identical to Upstox's, with no card.
 */
/** Header subline for the starting position: settling (T1) shares and today's delivery trades (CPO rulings, Q1). */
function startingSub(t1: number, today: TodayInfo | 'unavailable' | null): string | null {
  const settling = t1 > 0 ? `incl. ${shareCount(t1)} settling` : null;
  if (today === 'unavailable') return [settling, "excl. today's trades (unavailable)"].filter(Boolean).join(' · ');
  if (today && today.bought > 0) return settling ? `${settling}, ${shareCount(today.bought)} bought today` : `incl. ${shareCount(today.bought)} bought today`;
  if (today && today.sold > 0) return [settling, `after ${shareCount(today.sold)} sold today`].filter(Boolean).join(' · ');
  return settling;
}

export function indiaCard(a: IndiaCardArgs): { model: CardModel; c: IndiaResult } | null {
  const Q = heldQty(a.holding);
  if (!pricesUsable(a.p, a.ref) || !(Number.isFinite(a.q) && a.q > 0) || !heldOk(Q)) return null;
  const t1 = Number(a.holding.t1_quantity) || 0;
  const A = a.holding.average_price && a.holding.average_price > 0 ? a.holding.average_price : null;
  const c = computeIndia({ Q, A, q: a.q, p: a.p, ref: a.ref });
  const isGtt = a.tab === 'gtt';
  const refName = isGtt ? 'the trigger' : "today's price";
  const newAvg = c.newAvg as number;
  const dirWords = c.direction === 'lowers' ? 'lowers your average to' : c.direction === 'raises' ? 'raises your average to' : 'keeps your average at';
  const ex = a.exchange ?? 'NSE';
  const footer = { text: footInText(ex), tooltip: footInTip(ex) };
  const headerSub = startingSub(t1, a.today ?? null);
  const notice = c.hasAvg ? null : AVG_UNAVAILABLE;

  if (a.tab === 'mtf') {
    const youPay = a.mtfYouPay !== null && a.mtfYouPay > 0 ? a.mtfYouPay : null;
    const lead: Seg[] = [
      'MTF buys are funded separately and ',
      { b: 'leave your delivery average unchanged' },
      '. This order creates an MTF lot of ',
      { b: `${shareCount(a.q)} ${shares(a.q)} at ${inr(a.p)}` },
      youPay !== null ? ` — you pay ${inr(youPay, 0)}, Upstox funds the rest.` : '.',
    ];
    const rows: KvRow[] = [
      { k: 'Delivery shares', before: A ? `${shareCount(Q)} @ ${inr(A, 0)}` : shareCount(Q), after: 'unchanged' },
      { k: 'MTF lot', before: '—', after: `${shareCount(a.q)} @ ${inr(a.p, 0)}`, sub: 'interest applies daily' },
      { k: `All ${a.symbol} shares`, before: shareCount(Q), after: shareCount(c.newQty), sub: c.hasAvg ? `blended cost ${inr(newAvg)}` : undefined },
    ];
    return {
      c,
      model: {
        variant: 'mtf',
        title: TITLES.mtf,
        headerSub,
        headerRight: A ? [`Avg ${inr(A)} → `, { b: 'unchanged' }] : ['Avg unavailable'],
        lead,
        stats: null,
        why: null,
        rows,
        notice,
        chain: null,
        footer: { text: footInText(ex), tooltip: footMtfTip(ex) }, // the MTF card reads the Margin API, not trade history
      },
    };
  }

  const opener: Seg[] = isGtt
    ? ['If this GTT fires, buying ', { b: `${shareCount(a.q)} at ${inr(a.p)}` }]
    : ['Buying ', { b: `${shareCount(a.q)} more at ${inr(a.p)}` }];
  const lead: Seg[] = c.hasAvg
    ? [...opener, ` ${dirWords} `, { b: inr(newAvg) }, ' and puts ', { b: inr(c.orderValue, 0) }, ` more into ${a.symbol}.`]
    : [...opener, ' puts ', { b: inr(c.orderValue, 0) }, ` more into ${a.symbol}.`];

  const rows: KvRow[] = [{ k: 'Shares', before: shareCount(Q), after: shareCount(c.newQty) }];
  if (c.hasAvg) {
    rows.push({ k: 'Average price', before: inr(A as number), after: inr(newAvg), sub: breakEvenLine(c.gapAfter as number, c.gapBefore as number, refName) });
    const before = inr(c.moveBefore, 0);
    const after = inr(c.moveAfter, 0);
    // "— up from …" only when the row visibly changes (a tiny order can leave both figures equal)
    rows.push({ k: 'A 10% move is worth', before, after, sub: before === after ? TEN_PCT : `${TEN_PCT} — up from ${before} because you'll hold more shares` });
  }

  let chain: Chain;
  if (!a.history) chain = { kind: 'text', text: HISTORY_UNAVAILABLE };
  else if (a.history.lots.length === 0) {
    const since = a.windowStart ? ` since ${fmtMonthYear(a.windowStart)}` : '';
    chain = {
      kind: 'text',
      text: `No buys in your Upstox trade history${since} — these shares were bought earlier or came another way (IPO, corporate action, transfer).`,
    };
  } else {
    const dates = a.history.lots.map(l => fmtDate(l.date) + (l.local ? LOCAL_LOT : '')).join(' · ') + (a.windowStart ? ` · since ${fmtMonthYear(a.windowStart)}` : '');
    chain = chainFromLots(a.history.lots, a.history.predatesWindow, n => inr(n, 0), a.p, dates);
  }

  const headerRight: Seg[] = c.hasAvg ? [`Avg ${inr(A as number)} → `, { b: inr(newAvg) }] : ['Avg unavailable'];
  return {
    c,
    model: { variant: isGtt ? 'gtt' : 'regular', title: TITLES[a.tab], headerSub, headerRight, lead, stats: null, why: null, rows, notice, chain, footer },
  };
}

// ---------------------------------------------------------------- India: re-entry (sold out earlier)

export function reentryCard(symbol: string, sold: SoldOut, L: number, q: number, exchange: Exch = 'NSE'): CardModel {
  const r = computeReentry(sold.price, L);
  const same = inr(Math.abs(r.diff)) === inr(0);
  const gap = same ? 'the same' : `${inr(Math.abs(r.diff))} ${r.diff < 0 ? 'lower' : 'higher'}`;
  const lead: Seg[] = [
    'You sold ',
    { b: `${shareCount(sold.qty)} ${shares(sold.qty)} at ${inr(sold.price)}` },
    ` on ${fmtDate(sold.date)}. Today's price `,
    { b: inr(L) },
    ' is ',
    { b: same ? 'the same as your sale price' : gap },
    same ? '.' : ` (${signedPct(r.move)}).`,
    ` This order starts a fresh position of ${shareCount(q)} ${shares(q)} — there is no old average to blend with.`,
  ];
  return {
    variant: 'reentry',
    title: `You've owned ${symbol} before`,
    headerSub: null,
    headerRight: [`Sold at ${inr(sold.price)} · now `, { b: gap }],
    lead,
    stats: null,
    why: null,
    rows: [],
    notice: null,
    chain: null,
    footer: { text: FOOT_REENTRY_TEXT, tooltip: footInTip(exchange) },
  };
}

// ---------------------------------------------------------------- US (Alpaca paper + Upstox USD INR)

export interface UsLot extends Lot {
  fx: number; // ₹ per $ used for this lot (Upstox USD INR on its buy date)
  fxDate: string | null; // the candle date that rate came from; differs from the buy date when it fell back
  /** True when the buy date's daily close does not exist yet (a fill today): the rate is Upstox's live USD/INR. */
  fxLive?: boolean;
}

export interface UsCardArgs {
  symbol: string;
  Q: number;
  A: number;
  lots: UsLot[];
  predatesWindow: boolean;
  q: number;
  p: number;
  fxNow: number;
}

/**
 * One FX relation drives every FX phrase on the card: the rates are printed at 1 decimal, or at 2 when they tie
 * at 1, and "the same" is only said when the printed rates are equal at 2 decimals.
 */
function fxPrinting(now: number, then: number): { f: (n: number) => string; same: boolean } {
  if (num(now, 1) !== num(then, 1)) return { f: n => num(n, 1), same: false };
  if (num(now, 2) !== num(then, 2)) return { f: n => num(n, 2), same: false };
  return { f: n => num(n, 1), same: true };
}

const tone = (value: string, ratio: number): 'neg' | 'pos' | 'flat' => (value === '0.0%' ? 'flat' : ratio < 0 ? 'neg' : 'pos');

/** Null without a usable price or an existing Alpaca position (SPEC: no card and no simulated position before a fill). */
export function usCard(a: UsCardArgs): { model: CardModel; c: UsResult } | null {
  if (!pricesUsable(a.p, a.p) || !(Number.isFinite(a.q) && a.q > 0) || !(a.A > 0) || !heldOk(a.Q)) return null;
  const c = computeUS({ Q: a.Q, A: a.A, lots: a.lots, q: a.q, p: a.p, fxNow: a.fxNow });
  const usdWords =
    c.usdDirection === 'down' ? 'brings your dollar average down to' : c.usdDirection === 'up' ? 'raises your dollar average to' : 'keeps your dollar average at';
  const opener: Seg[] = ['Buying ', { b: `${qty(a.q)} more at ${usd(a.p)}` }, ` ${usdWords} `, { b: usd(c.newUsd) }];
  const rUsd = signedPct(c.rUsd);
  const stats: CardModel['stats'] = [{ label: 'Your return today, in dollars', value: rUsd, tone: tone(rUsd, c.rUsd) }];
  const rows: KvRow[] = [
    { k: 'Shares', before: qty(a.Q), after: qty(c.newQty) },
    { k: 'Average price in $', before: usd(a.A), after: usd(c.newUsd), sub: breakEvenLine(c.gapAfter, c.gapBefore, "today's price") },
  ];
  const lotDate = (l: UsLot) => istDate(Date.parse(l.date));
  let lead: Seg[];
  let why: string | null = null;
  let notice: string | null = null;
  let fxf = (n: number) => num(n, 1);

  const x = c.inr;
  const fxOk = (n: number) => Number.isFinite(n) && n > 0;
  if (!x) {
    lead = [...opener, '.'];
    notice = !fxOk(a.fxNow) || a.lots.some(l => !fxOk(l.fx)) ? INR_UNAVAILABLE_FX : INR_UNAVAILABLE_FILLS;
    rows.push({ k: 'A 10% move is worth', before: usd(c.moveUsdBefore, 0), after: usd(c.moveUsdAfter, 0), sub: TEN_PCT });
  } else {
    const fx = fxPrinting(a.fxNow, x.fxAvg);
    fxf = fx.f;
    const now = fx.f(a.fxNow);
    const then = fx.f(x.fxAvg);
    const earlier = a.lots.length === 1 ? 'buy' : 'buys'; // one earlier lot reads "your earlier buy" (CPO, US-card gate)
    const diverge = (c.usdDirection === 'down' && x.inrDirection === 'up') || (c.usdDirection === 'up' && x.inrDirection === 'down');
    const inrWord = x.inrDirection === 'up' ? 'up' : 'down';
    if (x.inrDirection === 'same') lead = [...opener, ' — and your rupee average stays at ', { b: inr(x.newInr, 0) }, '.'];
    else if (diverge && !fx.same)
      // SPEC case: the dollar and rupee averages move apart, which only a moved exchange rate can cause.
      lead = [...opener, ' — but your rupee average goes ', { b: inrWord }, ' to ', { b: inr(x.newInr, 0) }, `, because $1 costs ₹${now} today vs ₹${then} when you bought.`];
    else if (diverge) lead = [...opener, ' — but your rupee average goes ', { b: inrWord }, ' to ', { b: inr(x.newInr, 0) }, '.'];
    else if (fx.same)
      lead = [...opener, ' — and your rupee average goes ', { b: inrWord }, ' to ', { b: inr(x.newInr, 0) }, `, with $1 at ₹${now}, the same as when you bought.`];
    else lead = [...opener, ' — and your rupee average goes ', { b: inrWord }, ' to ', { b: inr(x.newInr, 0) }, `, with $1 at ₹${now} today vs ₹${then} when you bought.`];

    const rInr = signedPct(x.rInr);
    stats.push({ label: 'Your return today, in rupees', value: rInr, tone: tone(rInr, x.rInr) });
    if (rUsd !== rInr && !fx.same && pct(x.fxMove) !== '0.0%') {
      why = `Why they differ: the rupee ${x.fxMove > 0 ? 'weakened' : 'strengthened'} ${pct(x.fxMove)} since your ${earlier} (₹${then} → ₹${now} per $), which ${
        x.fxMove > 0 ? 'adds to' : 'takes from'
      } your rupee return.`;
    }
    const dirWord = x.inrDirection === 'up' ? 'Up' : x.inrDirection === 'down' ? 'Down' : 'Unchanged';
    const inrSub = fx.same
      ? `${dirWord} · $1 costs ₹${now} today, the same as at your earlier ${earlier}`
      : diverge
        ? `${dirWord} because $1 costs ₹${now} today vs ₹${then} at your earlier ${earlier}`
        : `${dirWord} · $1 costs ₹${now} today vs ₹${then} at your earlier ${earlier}`;
    rows.push({ k: 'Average price in ₹', before: inr(x.inrAvg, 0), after: inr(x.newInr, 0), sub: inrSub });
    rows.push({
      k: 'A 10% move is worth',
      before: usd(c.moveUsdBefore, 0),
      after: usd(c.moveUsdAfter, 0),
      sub: `≈ ${inr(x.moveInrBefore, 0)} → ${inr(x.moveInrAfter, 0)} · how much your money changes each time the price rises or falls 10%`,
    });
  }

  const dates =
    a.lots
      .map(l => {
        const d = lotDate(l);
        const tag = l.order_id === 'local' ? LOCAL_LOT : '';
        if (!fxOk(l.fx)) return fmtDate(d) + tag; // rate not loaded: show the date only, never a placeholder rate
        const fallback = l.fxLive ? ' (live rate until the day closes)' : l.fxDate && l.fxDate !== d ? ` (${fmtDayMonth(l.fxDate)} close)` : '';
        return `${fmtDate(d)}${tag} at ₹${fxf(l.fx)}/$${fallback}`;
      })
      .join(' · ') + (fxOk(a.fxNow) ? ` · today ₹${fxf(a.fxNow)}/$` : '');

  return {
    c,
    model: {
      variant: 'us',
      title: 'After this order',
      headerSub: null,
      headerRight: [`Avg ${usd(a.A)} → `, { b: usd(c.newUsd) }],
      lead,
      stats,
      why,
      rows,
      notice,
      chain: a.lots.length ? chainFromLots(a.lots, a.predatesWindow, n => usd(n), a.p, dates) : null,
      footer: { text: FOOT_US_TEXT, tooltip: FOOT_US_TIP },
    },
  };
}

// ---------------------------------------------------------------- confirmation sheet

export interface ReceiptModel {
  title: string;
  sub: string;
  label: string | null; // null: no Add-More Check box (a sell is not an add-more)
  lines: Seg[][];
  meta: string;
  /** Hover text on the meta line (API names and paths stay out of the visible copy). */
  metaTitle?: string;
  /** Whether the app updates the holdings table locally after "Done" (regular orders only). */
  updatesLocally: boolean;
}

export interface IndiaReceiptArgs {
  tab: Tab;
  symbol: string;
  held: { quantity: number; t1_quantity: number; average_price: number | null } | null;
  q: number;
  p: number;
  L: number;
  order: OrderResult;
  /** The exchange the order goes to; printed in the sub line like the sell sheet (CPO, final gate). */
  exchange?: Exch;
}

export function indiaReceipt(input: IndiaReceiptArgs): ReceiptModel {
  // A holdings row with no shares is "not held" here too (same rule as the card).
  const a: IndiaReceiptArgs = input.held && !heldOk(heldQty(input.held)) ? { ...input, held: null } : input;
  const placed = a.order.ok && a.order.mode === 'upstox_sandbox' && !!a.order.order_id;
  const title = (a.tab === 'gtt' ? 'GTT placed · ' : 'Order placed · ') + a.symbol;
  const product = a.tab === 'mtf' ? 'MTF' : 'Delivery';
  const tail = a.tab === 'gtt' ? ' · fires at trigger' : placed ? ' · Sandbox' : '';
  const sub = `Buy ${shareCount(a.q)} sh at ${inr(a.p)}${a.exchange ? ` · ${a.exchange}` : ''} · ${product}${tail}`;
  const Q = a.held ? heldQty(a.held) : 0;
  const A = a.held && a.held.average_price && a.held.average_price > 0 ? a.held.average_price : null;

  if (a.tab === 'gtt') {
    // Nothing has happened yet: every line is conditional on the trigger, and no local update follows.
    let lines: Seg[][];
    if (!a.held) lines = [['If it fires: new position ', { b: `${shareCount(a.q)} sh @ ${inr(a.p)}` }, ` · ${inr(a.q * a.p, 0)} in\u00a0${a.symbol}`]];
    else {
      const c = computeIndia({ Q, A, q: a.q, p: a.p, ref: a.p });
      const worth: Seg[] = [{ b: inr(c.newQty * a.p, 0) }, ` in\u00a0${a.symbol} if it fires (${shareCount(c.newQty)} sh at ${inr(a.p)})`];
      lines = !c.hasAvg
        ? [worth, [AVG_UNAVAILABLE]]
        : c.direction === 'keeps'
          ? [['If it fires: avg stays at ', { b: inr(A as number) }], worth, [`Your break-even would stay at ${inr(A as number)}`]]
          : [['If it fires: avg ', { b: `${inr(A as number)} → ${inr(c.newAvg as number)}` }], worth, [`Your break-even would be ${inr(c.newAvg as number)}`]];
    }
    return { title, sub, label: RECEIPT_LABEL, lines, meta: NOT_WIRED_NO_CHANGE, updatesLocally: false };
  }

  if (!a.held) {
    const isMtf = a.tab === 'mtf';
    const lines: Seg[][] = isMtf
      ? [['MTF lot ', { b: `${shareCount(a.q)} sh at ${inr(a.p)}` }, ` · ${inr(a.q * a.p, 0)} in\u00a0${a.symbol}`]]
      : [['New position: ', { b: `${shareCount(a.q)} sh @ ${inr(a.p)}` }, ` · ${inr(a.q * a.p, 0)} in\u00a0${a.symbol}`]];
    const meta = isMtf
      ? placed
        ? `Upstox sandbox order ${a.order.order_id}. In production the MTF lot comes from re-fetching positions after the fill.`
        : NOT_WIRED_NO_CHANGE
      : placed
        ? `Upstox sandbox order ${a.order.order_id}. Position updated locally — in production this comes from re-fetching holdings after the fill.`
        : NOT_WIRED;
    return { title, sub, label: RECEIPT_LABEL, lines, meta, updatesLocally: !isMtf };
  }

  const c = computeIndia({ Q, A, q: a.q, p: a.p, ref: a.L });
  const worth: Seg[] = [{ b: inr(c.newQty * a.L, 0) }, ` in\u00a0${a.symbol} (${shareCount(c.newQty)} sh at ${inr(a.L)})`];
  if (a.tab === 'mtf') {
    // MTF lots are funded and tracked separately from delivery holdings, so the holdings table is not changed.
    const lines: Seg[][] = A
      ? [['Delivery average ', { b: `${inr(A)} · unchanged` }], ['MTF lot ', { b: `${shareCount(a.q)} sh at ${inr(a.p)}` }], worth]
      : [['MTF lot ', { b: `${shareCount(a.q)} sh at ${inr(a.p)}` }], worth];
    const meta = placed
      ? `Upstox sandbox order ${a.order.order_id}. In production the MTF lot comes from re-fetching positions after the fill.`
      : NOT_WIRED_NO_CHANGE;
    return { title, sub, label: RECEIPT_LABEL, lines, meta, updatesLocally: false };
  }
  const lines: Seg[][] = !c.hasAvg
    ? [worth, [AVG_UNAVAILABLE]]
    : c.direction === 'keeps'
      ? [['Avg stays at ', { b: inr(A as number) }], worth, [`Your break-even stays at ${inr(A as number)}`]]
      : [['Avg moved ', { b: `${inr(A as number)} → ${inr(c.newAvg as number)}` }], worth, [`Your break-even is now ${inr(c.newAvg as number)}`]];
  const meta = placed
    ? `Upstox sandbox order ${a.order.order_id}. Position updated locally — in production this comes from re-fetching holdings after the fill.`
    : NOT_WIRED;
  return { title, sub, label: RECEIPT_LABEL, lines, meta, updatesLocally: true };
}

export interface SellReceiptArgs {
  tab: Tab;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  q: number;
  p: number;
  order: OrderResult;
}

/**
 * Sell ticket confirmation (Upstox flow: Sell → exchange → ticket). Add-More Check is a buy-side card, so the sheet
 * carries no Add-More lines; the holdings table is never changed locally for a sale.
 */
export function sellReceipt(a: SellReceiptArgs): ReceiptModel {
  const placed = a.order.ok && a.order.mode === 'upstox_sandbox' && !!a.order.order_id;
  const title = (a.tab === 'gtt' ? 'GTT placed · ' : 'Order placed · ') + a.symbol;
  const tail = a.tab === 'gtt' ? ' · fires at trigger' : placed ? ' · Sandbox' : '';
  const sub = `Sell ${shareCount(a.q)} sh at ${inr(a.p)} · ${a.exchange} · Delivery${tail}`;
  const meta = placed ? `Upstox sandbox order ${a.order.order_id}. Your Upstox holdings change only when a real order fills.` : NOT_WIRED_NO_CHANGE;
  return { title, sub, label: null, lines: [], meta, updatesLocally: false };
}

export interface UsSellReceiptArgs {
  symbol: string;
  q: number;
  p: number;
}

/** US sell ticket confirmation: never sent (CPO Q8), no Add-More lines, the Alpaca position is not changed locally. */
export function usSellReceipt(a: UsSellReceiptArgs): ReceiptModel {
  return { title: `Order placed · ${a.symbol}`, sub: `Sell ${qty(a.q)} sh at ${usd(a.p)}`, label: null, lines: [], meta: NOT_WIRED_NO_CHANGE, updatesLocally: false };
}

export interface UsReceiptArgs {
  symbol: string;
  held: { Q: number; A: number; inrAvg: number | null } | null;
  q: number;
  p: number;
  fxNow: number | null;
}

/**
 * US orders are never sent (CPO ruling: order placement is limited to the Upstox sandbox); the sheet says so.
 * With no Alpaca position nothing is simulated (SPEC: "no simulated position"); an existing one is updated locally.
 */
export function usReceipt(a: UsReceiptArgs): ReceiptModel {
  const title = `Order placed · ${a.symbol}`;
  const sub = `Buy ${qty(a.q)} sh at ${usd(a.p)}`;
  if (!a.held) {
    // Nothing is sent and nothing is simulated, so the line stays conditional (like the GTT "If it fires: …").
    const lines: Seg[][] = [['If it fills: new position ', { b: `${qty(a.q)} sh @ ${usd(a.p)}` }, ` · ${usd(a.q * a.p)} in\u00a0${a.symbol}`]];
    return { title, sub, label: RECEIPT_LABEL, lines, meta: NOT_WIRED_NO_CHANGE, updatesLocally: false };
  }
  const newQty = a.held.Q + a.q;
  const newUsd = (a.held.Q * a.held.A + a.q * a.p) / newQty;
  const moved = (label: string, before: string, after: string): Seg[] =>
    before === after ? [`${label} stays at `, { b: before }] : [`${label} moved `, { b: `${before} → ${after}` }];
  const lines: Seg[][] = [moved('$ avg', usd(a.held.A), usd(newUsd))];
  if (a.fxNow !== null && a.held.inrAvg !== null) {
    const newInr = (a.held.Q * a.held.inrAvg + a.q * a.p * a.fxNow) / newQty;
    lines.push(moved('₹ avg', inr(a.held.inrAvg, 0), inr(newInr, 0)));
    lines.push([{ b: inr(newQty * a.p * a.fxNow, 0) }, ` in\u00a0${a.symbol} (${qty(newQty)} sh)`]);
  } else lines.push([{ b: usd(newQty * a.p) }, ` in\u00a0${a.symbol} (${qty(newQty)} sh)`]);
  return { title, sub, label: RECEIPT_LABEL, lines, meta: NOT_WIRED, updatesLocally: true };
}
