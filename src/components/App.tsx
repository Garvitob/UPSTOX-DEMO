'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmSheet } from './ConfirmSheet';
import { ExchangeModal, type ExchangeOption } from './ExchangeModal';
import { OrderPanel, type Exchange, type IndiaTicketVM, type MobOption, type Side, type UsTicketVM } from './OrderPanel/OrderPanel';
import { HoldingsPanel, type InRow, type UsView } from './Shell/HoldingsPanel';
import { Ticker } from './Shell/Ticker';
import { TopBar } from './Shell/TopBar';
import { Watchlist, type WatchItem } from './Shell/Watchlist';
import type { Chip } from './SourceChips';
import { useJson } from '@/hooks/useJson';
import { useLivePrices } from '@/hooks/useLivePrice';
import { useUsData } from '@/hooks/useUs';
import { buyHistory, computeIndia, computeUS, defaultTrigger, heldQty, holdingInvested, lotsAtLiveRate, marginAnswerFor, marketSampleStep, tickFor, usQtyValid, type MarketSample, mtfForOrder, mtfMultiplier, resolvePrices, soldOut, todaysTrades, withToday, type PriceMode, type Tab, type TodayInfo } from '@/lib/compute';
import { INR_UNAVAILABLE_FILLS_ERROR, indiaCard, indiaReceipt, reentryCard, sellReceipt, usCard, usReceipt, usSellReceipt, type CardModel, type ReceiptModel, type UsLot } from '@/lib/copy';
import { fmtDate, fmtDayMonth, fmtFetched, fmtIstClock, fmtIstStamp, fmtLastTraded, istDate, num } from '@/lib/format';
import type { ApiError, FundsPayload, HoldingRow, HoldingsPayload, InstrumentsPayload, MarginPayload, OrderRequest, OrderResult, TradeRow, TradesPayload } from '@/lib/types';
import { useDebounced } from '@/hooks/useDebounced';

// The whole page: Upstox Pro holdings replica + Place Order panel with Add-More Check. Every number on screen comes
// from an /api route (live Upstox / Alpaca, or a labelled cache written from them). The constants below are ticket
// input defaults copied from the reference, not data.
const DEFAULT_QTY = 1; // Upstox Pro opens every ticket at quantity 1 (reference/screenshots/upstox-pro-order-panel-open.png)
const MAX_QTY_IN = 9_999_999; // the quantity input also caps its length; never Infinity / float-rounded counts
const MAX_QTY_US = 999_999;
const MKT_REFRESH_MS = 5_000; // a Market ticket re-asks the Margin API for a moving LTP at most this often (SPEC: never hammer)

interface Holding {
  quantity: number;
  t1_quantity: number;
  average_price: number | null;
}
interface LocalIn {
  holding: Holding;
  trades: TradeRow[]; // the confirmed orders of this session, shown in the chain (labelled "updated locally")
  orderIds: string[];
}
interface LocalUs {
  Q: number;
  A: number;
  lots: UsLot[];
}
interface Flags {
  sandbox_order: boolean;
}

/** Invested for a holdings row as Upstox computes it (holdingInvested), plus this session's confirmed buys. */
function investedOf(h: HoldingRow, lc: LocalIn | undefined): number | null {
  const snap = holdingInvested(h);
  return snap === null ? null : snap + (lc ? lc.trades.reduce((s, t) => s + t.quantity * t.price, 0) : 0);
}

const notWired = (detail: string): OrderResult => ({ ok: false, mode: 'not_wired', order_id: null, detail });
const parseNum = (s: string): number | null => {
  const v = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Why holdings came from the cache, in ARCHITECTURE's words (401 → token, 429 → rate limited, network → unreachable). */
function cacheReason(e: ApiError | undefined): string {
  if (e?.code === 'unauthorized') return `Upstox OAuth token not accepted (${e.message})`;
  if (e?.code === 'rate_limited') return 'Upstox rate limited, retrying';
  if (e?.code === 'network') return 'Upstox unreachable';
  return `Upstox holdings error (${e?.message ?? 'no response'})`;
}

async function postOrder(req: OrderRequest): Promise<OrderResult> {
  try {
    const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const j = (await r.json()) as Partial<OrderResult> | null;
    return j && typeof j.ok === 'boolean' && j.mode ? (j as OrderResult) : notWired(`HTTP ${r.status}`);
  } catch (e) {
    return notWired(`request failed: ${(e as Error).message}`);
  }
}

export function App() {
  const inst = useJson<InstrumentsPayload>('/api/instruments');
  const hold = useJson<HoldingsPayload>('/api/holdings');
  const flags = useJson<Flags>('/api/order');

  // `market` is the market of the stock whose ticket is open (set by the Buy/Sell that was pressed); `holdTab` is only
  // the holdings table's tab. Switching the tab never changes an open ticket.
  const [market, setMarket] = useState<'IN' | 'US'>('IN');
  const [holdTab, setHoldTab] = useState<'IN' | 'US'>('IN');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('regular');
  const [qtyText, setQtyText] = useState(String(DEFAULT_QTY));
  const [priceMode, setPriceMode] = useState<PriceMode>('market');
  const [limitText, setLimitText] = useState('');
  const [triggerText, setTriggerText] = useState('');
  const [triggerFor, setTriggerFor] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false); // SPEC: collapsed by default
  const [usQtyText, setUsQtyText] = useState('1');
  const [usVisited, setUsVisited] = useState(false);
  const [localIn, setLocalIn] = useState<Record<string, LocalIn>>({});
  const [localUs, setLocalUs] = useState<LocalUs | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [receipt, setReceipt] = useState<ReceiptModel | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const reloadTrades = useRef<(() => void) | null>(null);
  // Upstox flow: hover a row → Buy / Sell → "Exchange to Buy From" (NSE / BSE) → the Place Order panel opens.
  const [panelOpen, setPanelOpen] = useState(false); // desktop starts with no ticket, like Upstox Pro's holdings page
  const [side, setSide] = useState<Side>('BUY');
  const [openedSide, setOpenedSide] = useState<Side>('BUY'); // the Buy / Sell that opened the ticket (GTT's Side toggle stays inside GTT)
  const [exchange, setExchange] = useState<Exchange>('NSE');
  const [pick, setPick] = useState<{ symbol: string; side: Side } | null>(null);
  const [isPhone, setIsPhone] = useState(false); // below 900px the ticket is the whole page (UI_REFERENCE phone layout)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setIsPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const holdings = useMemo(() => hold.data?.holdings ?? [], [hold.data]);
  const equities = useMemo(() => inst.data?.equities ?? [], [inst.data]);
  const bySymbol = useMemo(() => new Map(equities.map(e => [e.symbol, e])), [equities]);
  const byIsin = useMemo(() => new Map(equities.map(e => [e.isin, e])), [equities]);

  // ---------------------------------------------------------------- live prices (one stream for everything)
  const liveKeys = useMemo(() => {
    if (!inst.data || !hold.data) return [];
    const k = new Set<string>();
    for (const e of equities) {
      k.add(e.instrument_key);
      if (e.bse_key) k.add(e.bse_key);
    }
    for (const h of holdings) if (h.instrument_token) k.add(h.instrument_token);
    for (const i of inst.data.indices) k.add(i.instrument_key);
    return [...k];
  }, [inst.data, hold.data, equities, holdings]);
  const live = useLivePrices(liveKeys);

  // Held status is matched on ISIN (API_UPSTOX: "Match on isin"), so a watchlist symbol that differs from the
  // holding's trading_symbol still finds the position.
  const isinOf = useCallback((sym: string) => bySymbol.get(sym)?.isin ?? holdings.find(h => h.trading_symbol === sym)?.isin ?? null, [bySymbol, holdings]);

  // ---------------------------------------------------------------- selection
  /** A fresh ticket for a symbol: Regular, Market, quantity 1 — what Upstox Pro shows when its order panel opens. */
  const select = useCallback((sym: string) => {
    setMarket('IN');
    setSymbol(sym);
    setQtyText(String(DEFAULT_QTY));
    setTab('regular');
    setPriceMode('market');
    setLimitText('');
    setTriggerText('');
    setTriggerFor(null);
    setCardOpen(false);
    reloadTrades.current?.(); // re-selecting the same symbol refetches its trade history
  }, []);

  /** The instrument keys a symbol trades under (from the Upstox instrument master): NSE_EQ|ISIN and/or BSE_EQ|ISIN. */
  const keysOf = useCallback(
    (sym: string) => {
      const i = isinOf(sym);
      const e = bySymbol.get(sym) ?? (i ? byIsin.get(i) : undefined);
      const h = i ? holdings.find(x => x.isin === i) : undefined;
      const nse = e?.instrument_key.startsWith('NSE_EQ') ? e.instrument_key : h?.instrument_token.startsWith('NSE_EQ') ? h.instrument_token : null;
      const bse = e?.bse_key ?? (e?.instrument_key.startsWith('BSE_EQ') ? e.instrument_key : h?.instrument_token.startsWith('BSE_EQ') ? h.instrument_token : null);
      return { nse, bse };
    },
    [bySymbol, byIsin, holdings, isinOf],
  );

  const openTicket = useCallback(
    (sym: string, s: Side, ex: Exchange) => {
      select(sym);
      setSide(s);
      setOpenedSide(s);
      setExchange(ex);
      setPick(null);
      setPanelOpen(true);
    },
    [select],
  );

  /** Buy / Sell on a holdings or watchlist row: Upstox Pro asks for the exchange first when the stock trades on both. */
  const requestTrade = useCallback(
    (sym: string, s: Side) => {
      const k = keysOf(sym);
      if (k.nse && k.bse) setPick({ symbol: sym, side: s });
      else openTicket(sym, s, k.nse ? 'NSE' : 'BSE');
    },
    [keysOf, openTicket],
  );

  useEffect(() => {
    if (symbol || !hold.data || !inst.data) return;
    const loss = holdings.find(h => h.average_price > 0 && h.last_price < h.average_price) ?? holdings[0];
    const first = loss?.trading_symbol ?? inst.data.watchlist.items[0]?.symbol;
    // only picks the phone selector's first stock: never touches the market, side, card or panel of a ticket the user
    // may already have opened (e.g. a US ticket opened before /api/holdings answered — CTO, gate run 2)
    if (first) setSymbol(first);
  }, [symbol, hold.data, inst.data, holdings]);

  // Load the US tab's data quietly once the India page has settled, so switching tabs is instant.
  useEffect(() => {
    const t = setTimeout(() => setUsVisited(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const showHoldings = (m: 'IN' | 'US') => {
    setHoldTab(m);
    if (m === 'US') setUsVisited(true);
  };
  /** Buy / Sell on a row of the US Stocks tab (or the phone selector): the panel opens on the US ticket. */
  const openUsTicket = (s: Side) => {
    setMarket('US');
    setSide(s);
    setOpenedSide(s);
    setUsQtyText('1');
    setCardOpen(false);
    setUsVisited(true);
    setPick(null);
    setPanelOpen(true);
  };

  // ---------------------------------------------------------------- India: selected instrument
  const symIsin = symbol ? isinOf(symbol) : null;
  const heldRow = symIsin ? holdings.find(h => h.isin === symIsin) ?? null : null;
  const info = symbol ? bySymbol.get(symbol) ?? (heldRow ? byIsin.get(heldRow.isin) ?? null : null) : null;
  const symKeys = symbol ? keysOf(symbol) : { nse: null, bse: null };
  const exch: Exchange = exchange === 'BSE' && symKeys.bse ? 'BSE' : symKeys.nse ? 'NSE' : 'BSE';
  const key = (exch === 'BSE' ? symKeys.bse : symKeys.nse) ?? heldRow?.instrument_token ?? info?.instrument_key ?? null;
  const isin = heldRow?.isin || info?.isin || null;
  const q0 = key ? live.quotes[key] : undefined;
  const L = q0?.last_price ?? null; // LTP of the exchange this ticket trades on
  const nsePx = symKeys.nse ? live.quotes[symKeys.nse]?.last_price ?? null : null;
  const bsePx = symKeys.bse ? live.quotes[symKeys.bse]?.last_price ?? null : null;
  const tick = tickFor(info, exch); // the instrument master's tick of the exchange this ticket trades on
  const exMarket = live.markets[exch]; // the picked exchange's own status (GET /v2/market/status/{NSE|BSE} or feed)
  const local = symbol ? localIn[symbol] : undefined;
  // CPO ruling Q1: the card starts from Upstox Holdings + today's executed delivery trades (fetched on the same IST day
  // as the Holdings snapshot). The holdings table itself stays exactly as Upstox Holdings returns it.
  const todayRows = todaysTrades(hold.data?.fetched_at ?? null, hold.data?.today, isin);
  const heldBase = heldRow
    ? { quantity: heldRow.quantity, t1_quantity: heldRow.t1_quantity, average_price: heldRow.average_price, cnc_used_quantity: heldRow.cnc_used_quantity }
    : null;
  const start = todayRows === 'unavailable' ? (heldBase ? { holding: heldBase, today: null } : null) : withToday(heldBase, todayRows);
  const todayInfo: TodayInfo | 'unavailable' | null = todayRows === 'unavailable' ? (heldBase ? 'unavailable' : null) : start?.today ?? null;
  const holding: Holding | null = local ? local.holding : start ? start.holding : null;
  const Q = holding ? heldQty(holding) : 0;

  const trades = useJson<TradesPayload>(market === 'IN' && isin ? `/api/trades?isin=${isin}` : null);
  reloadTrades.current = trades.reload;
  const tradesFor = trades.data && trades.data.isin === isin ? trades.data : null;
  // the request itself failed (after retries): the card still renders, with "Buy history unavailable"
  const tradesFailed = !tradesFor && !!trades.error && !trades.loading;
  const histOk = !!tradesFor && tradesFor.source !== 'unavailable';
  // Trade History + today's delivery trades not already in it (same trade_id) + this session's confirmed orders
  const histRows = histOk ? (tradesFor as TradesPayload).trades : [];
  const histIds = new Set(histRows.map(t => t.trade_id).filter((id): id is string => !!id));
  const todayNew = Array.isArray(todayRows) ? todayRows.filter(t => !t.trade_id || !histIds.has(t.trade_id)) : [];
  const allTrades = histOk ? [...histRows, ...todayNew, ...(local?.trades ?? [])] : [];
  const history = holding && histOk ? buyHistory(allTrades, Q) : null;
  const sold = !holding && histOk ? soldOut(allTrades, 0) : null;

  // MTF margin: one Margin API call per instrument (one share at the price seen when it was selected).
  const [marginAt, setMarginAt] = useState<{ key: string; price: number } | null>(null);
  useEffect(() => {
    if (key && L !== null && marginAt?.key !== key) setMarginAt({ key, price: L });
  }, [key, L, marginAt]);
  const margin = useJson<MarginPayload>(marginAt ? `/api/margin?key=${encodeURIComponent(marginAt.key)}&price=${marginAt.price}` : null);
  const mOk = margin.data && margin.data.instrument_key === key && margin.data.required_margin !== null ? margin.data : null;
  const mtfPerShare = mOk && L !== null ? mtfForOrder(mOk.required_margin as number, mOk.price, 1, L) : null;
  const mtfBadge = mOk ? mtfMultiplier(mOk.required_margin as number, mOk.price) : null;

  // default GTT trigger (Upstox Pro: LTP − 0.25 % rounded to tick), set once per symbol
  useEffect(() => {
    const k = symbol ? `${symbol}|${exch}` : null;
    if (tab === 'gtt' && k && L !== null && triggerFor !== k) {
      setTriggerText(defaultTrigger(L, tick).toFixed(2)); // Upstox prints the trigger ungrouped ("1651.90")
      setTriggerFor(k);
    }
  }, [tab, symbol, exch, L, tick, triggerFor]);

  const q = Math.min(MAX_QTY_IN, Math.max(1, parseInt(qtyText, 10) || 1));
  const prices = L !== null ? resolvePrices({ tab, priceMode, L, limit: parseNum(limitText), trigger: parseNum(triggerText) ?? defaultTrigger(L, tick) }) : null;
  const youPay = mOk && prices ? mtfForOrder(mOk.required_margin as number, mOk.price, q, prices.p) : null;

  // Never send (or show a receipt for) a price the input does not show: a cleared/invalid limit or trigger disables Review…
  const priceInputOk = tab === 'gtt' ? parseNum(triggerText) !== null : priceMode === 'market' || parseNum(limitText) !== null;
  // …and the quantity box must hold a real quantity (an empty or 0 box never sends the 1-share fallback)
  const qtyOk = /^\d+$/.test(qtyText) && parseInt(qtyText, 10) >= 1;

  // "Required" is the Margin API's answer for this exact order (delivery BUY 1 @ 1656 → 1656.00, SELL → 0.00, MTF →
  // the MTF margin); "Available" is the Funds API. Both are real Upstox data, refetched as the ticket changes. While the
  // quantity or price box does not hold a valid value there is no exact order to ask about, so Required shows "—".
  const ticketVisible = panelOpen || isPhone;
  const product = tab === 'mtf' ? 'MTF' : 'D';
  // On a Market order the price is the live LTP, and a tick is not a change to the order (CPO, gate run 3 follow-up): the
  // Margin API is asked at a sampled price that follows the LTP at most every MKT_REFRESH_MS, its answer is matched on
  // instrument + quantity + side + product (at the current or the previous sample), and the last answer stays on screen
  // while a refresh is in flight. Every change the user makes — stock, exchange, side, tab, quantity, Market ⇄ Limit,
  // limit / trigger price — still asks again at once (and pends the button until Upstox answers).
  const isMarket = tab !== 'gtt' && priceMode === 'market';
  const orderId = `${key}|${q}|${side}|${product}|${tab}|${priceMode}`;
  const pNow = prices?.p ?? null;
  const [mktPx, setMktPx] = useState<MarketSample | null>(null);
  useEffect(() => {
    if (!isMarket || pNow === null) return;
    const step = marketSampleStep(mktPx, orderId, pNow, Date.now(), MKT_REFRESH_MS);
    if (!step) return;
    if (!mktPx || mktPx.id !== orderId) {
      setMktPx(step.next(Date.now())); // a new order: sample now
      return;
    }
    // a moved price: sampled at the fixed deadline (ticks never move it), unless the order changes first
    const t = setTimeout(() => setMktPx(m => (m && m.id === orderId ? step.next(Date.now()) : m)), step.delayMs);
    return () => clearTimeout(t);
  }, [isMarket, orderId, pNow, mktPx]);
  const mktCur = isMarket && mktPx?.id === orderId ? mktPx : null;
  const reqPrice = pNow === null ? null : mktCur ? mktCur.p : pNow;
  const reqUrlNow =
    market === 'IN' && key && reqPrice !== null && qtyOk && priceInputOk ? `/api/margin?key=${encodeURIComponent(key)}&price=${reqPrice}&qty=${q}&side=${side}&product=${product}` : null;
  const reqUrl = useDebounced(reqUrlNow, 350);
  const reqMargin = useJson<MarginPayload>(ticketVisible ? reqUrl : null);
  const rm = reqMargin.data;
  const reqLive = marginAnswerFor(rm, { key, q, side, product }, { sample: mktCur, pNow });
  // "Required" is only ever the Margin API's answer for this exact order: "—" while it loads or when it fails (CTO, gate run 2)
  const required = reqLive;
  // funds are used on every Indian ticket except a GTT buy (its footer shows "With MTF" and nothing is blocked)
  const fundsInUse = ticketVisible && market === 'IN' && !(tab === 'gtt' && side === 'BUY');
  const funds = useJson<FundsPayload>(fundsInUse ? '/api/funds' : null, fundsInUse ? 30_000 : undefined);
  const available = funds.data?.available ?? null;
  const fundsNote = funds.data && funds.data.source === 'unavailable' ? `Upstox funds unavailable: ${funds.data.error?.message ?? 'no response'}` : null;
  // Upstox Pro: a BUY on Regular / MTF that needs more than the available funds shows "Add funds" (GTT blocks nothing).
  // That button is decided from two answers for this exact order — Required (Margin API) and Available (Funds API: a
  // balance, or its own closed/unavailable answer). Until both are in, the button and the funds line keep what they last
  // showed for this stock on any tab, and the button is disabled, so a tab / exchange / quantity change never flashes a
  // clickable "Review buy order" (CPO, gate run 3). A failed request settles too: a failure never blocks the buy.
  const fundsGated = market === 'IN' && side === 'BUY' && tab !== 'gtt';
  // settled = the request for the current order finished (success or failure); on a Market order an answer for this order
  // at the current or previous sample also counts while the next sample is in flight (a tick never re-pends the button)
  const marginSettled = (reqUrlNow !== null && reqUrl === reqUrlNow && !reqMargin.loading) || (mktCur !== null && reqLive !== null);
  const fundsSettled = funds.data !== null || funds.error !== null;
  const ctaReady = !fundsGated || (marginSettled && fundsSettled);
  const insufficientNow = fundsGated && available !== null && required !== null && required > available + 1e-9;
  const holdKey = `${market}|${symbol}|${exch}|${side}`;
  const ctaHold = useRef<{ key: string; v: boolean } | null>(null);
  useEffect(() => {
    if (fundsGated && ctaReady) ctaHold.current = { key: holdKey, v: insufficientNow };
  }, [fundsGated, ctaReady, holdKey, insufficientNow]);
  const insufficient = ctaReady ? insufficientNow : fundsGated && ctaHold.current?.key === holdKey && ctaHold.current.v;
  // A failed Margin API answer leaves Required "—": say why on hover and ask Upstox once more by itself (⟳ retries too).
  const marginError = marginSettled && required === null ? (reqMargin.error ?? (rm?.error ? rm.error.message : null)) : null;
  const marginRetried = useRef<string | null>(null);
  const reloadMargin = reqMargin.reload; // stable (useCallback), so the timer below is not cleared by every render
  useEffect(() => {
    if (!marginError || !reqUrl || marginRetried.current === reqUrl) return;
    marginRetried.current = reqUrl;
    const t = setTimeout(reloadMargin, 2000);
    return () => clearTimeout(t);
  }, [marginError, reqUrl, reloadMargin]);

  let inCard: CardModel | null = null;
  if (market === 'IN' && side === 'BUY' && symbol && prices && (tradesFor || tradesFailed)) {
    if (holding) {
      inCard =
        indiaCard({ tab, symbol, holding, q, p: prices.p, ref: prices.ref, history, windowStart: tradesFor?.window?.start_date ?? null, mtfYouPay: youPay, today: todayInfo, exchange: exch })?.model ?? null;
    } else if (sold && L !== null) inCard = reentryCard(symbol, sold, L, q, exch);
  }

  const indiaVM: IndiaTicketVM | null = symbol
    ? {
        symbol,
        side,
        exchange: exch,
        onExchange: ex => setExchange(ex),
        L,
        cp: q0?.cp ?? null,
        nse: nsePx,
        bse: bsePx,
        ltt: q0?.ltt ?? null,
        marketOpen: exMarket ? exMarket.open : null,
        tab,
        onTab: t => {
          // GTT's Side [Buy | Sell] belongs to the GTT order: leaving GTT restores the side the ticket was opened with
          if (t !== 'gtt' && side !== openedSide) {
            setSide(openedSide);
            if (openedSide === 'SELL' && t === 'mtf') {
              setTab('regular');
              return;
            }
          }
          setTab(t);
        },
        onSide: s => setSide(s),
        openedSide,
        qtyText,
        onQtyText: setQtyText,
        onQtyStep: d => setQtyText(String(Math.max(1, q + d))),
        priceMode,
        onTogglePriceMode: () => {
          if (priceMode === 'market') {
            setPriceMode('limit');
            if (L !== null) setLimitText(L.toFixed(2));
          } else setPriceMode('market');
        },
        limitText,
        onLimitText: s => {
          setLimitText(s);
          if (priceMode === 'market' && s) setPriceMode('limit'); // Upstox: typing a price turns a Market order into a Limit order
        },
        triggerText,
        onTriggerText: setTriggerText,
        tick,
        mtfPerShare,
        mtfBadge,
        card: inCard,
        cardNote: holding && L === null && live.loaded ? `Live ${exch} price unavailable right now — the card needs it.` : null,
        cardOpen,
        onToggleCard: () => setCardOpen(o => !o),
        required,
        requiredNote: marginError ? `Upstox Margin API unavailable: ${marginError} · ⟳ to retry` : null,
        withMtf: youPay,
        available,
        fundsNote,
        insufficient,
        onRefresh: () => {
          reqMargin.reload();
          funds.reload();
        },
      }
    : null;

  // ---------------------------------------------------------------- holdings table (India)
  const inRows: InRow[] = useMemo(() => {
    const rows: InRow[] = holdings.map(h => {
      const lc = localIn[h.trading_symbol];
      const hh = lc ? lc.holding : h;
      const qq = live.quotes[h.instrument_token];
      return {
        symbol: h.trading_symbol,
        Q: heldQty(hh),
        A: hh.average_price && hh.average_price > 0 ? hh.average_price : null,
        // Upstox's Invested = quantity × last_price − pnl of the same Holdings snapshot (its unrounded average);
        // shares bought in this session add q × p.
        invested: investedOf(h, lc),
        L: qq?.last_price ?? null,
        cp: qq?.cp ?? null,
        local: lc ? { orderId: lc.orderIds.at(-1) ?? null } : null,
        localBuys: lc ? lc.trades.map(t => ({ qty: t.quantity, price: t.price })) : [],
      };
    });
    for (const [sym, lc] of Object.entries(localIn)) {
      if (holdings.some(h => h.trading_symbol === sym)) continue;
      const e = bySymbol.get(sym);
      const qq = e ? live.quotes[e.instrument_key] : undefined;
      rows.push({
        symbol: sym,
        Q: heldQty(lc.holding),
        A: lc.holding.average_price,
        invested: lc.trades.reduce((s, t) => s + t.quantity * t.price, 0),
        L: qq?.last_price ?? null,
        cp: qq?.cp ?? null,
        local: { orderId: lc.orderIds.at(-1) ?? null },
        localBuys: lc.trades.map(t => ({ qty: t.quantity, price: t.price })),
      });
    }
    return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [holdings, localIn, live.quotes, bySymbol]);
  const holdingsState: 'loading' | 'ok' | 'unavailable' = !hold.data ? (hold.error ? 'unavailable' : 'loading') : hold.data.source === 'unavailable' ? 'unavailable' : 'ok';
  const holdingsMessage = !hold.data
    ? hold.error
      ? `Could not reach this app's /api/holdings (${hold.error}) after 3 retries — reload the page.`
      : 'Loading your Upstox holdings…'
    : `Holdings unavailable — Upstox said "${hold.data.error?.message ?? 'no response'}" and there is no cached copy.`;
  const allPriced = inRows.length > 0 && inRows.every(r => r.L !== null && r.A !== null);
  const holdingsPnl = allPriced ? inRows.reduce((s, r) => s + ((r.L as number) - (r.A as number)) * r.Q, 0) : null;

  const watchItems: WatchItem[] = useMemo(() => {
    const items: WatchItem[] = (inst.data?.watchlist.items ?? []).map(w => ({ symbol: w.symbol, label: w.label, key: w.instrument_key }));
    for (const h of holdings) {
      if (!items.some(i => i.symbol === h.trading_symbol)) items.push({ symbol: h.trading_symbol, label: byIsin.get(h.isin)?.label ?? `${h.exchange} EQ`, key: h.instrument_token });
    }
    return items;
  }, [inst.data, holdings, byIsin]);

  // ---------------------------------------------------------------- US (Alpaca paper + Upstox USD/INR)
  const us = useUsData(usVisited, market === 'US' || holdTab === 'US');
  const usSym = us.positions?.symbol ?? inst.data?.us_symbol ?? null;
  const apiPos = us.positions?.position ?? null;
  const usP = us.price?.price ?? null;
  const fxNow = us.fx?.rate ?? null;
  const usQ = Math.min(MAX_QTY_US, Math.max(0.1, Number(usQtyText) || 1));
  // The US quantity is fractional, at least 0.1 share (SPEC Inputs) — the bounds usQ is clamped to, so a receipt or
  // Required never shows a quantity nobody typed
  const usQtyOk = usQtyValid(usQtyText, MAX_QTY_US);
  const apiLots: UsLot[] = (us.history?.lots ?? []).map(l => {
    const f = us.fxByDate[istDate(Date.parse(l.date))];
    return { ...l, fx: f?.rate ?? NaN, fxDate: f?.date ?? null, fxLive: f?.basis === 'feed' || f?.basis === 'intraday' };
  });
  const usHeld = localUs ? { Q: localUs.Q, A: localUs.A } : apiPos ? { Q: apiPos.qty, A: apiPos.avg_entry_price } : null;
  // A lot bought today has no daily close yet, so it uses today's live USD/INR — the same rate the card shows as "today"
  // (one live rate on screen, never two readings minutes apart; CPO, US-card gate).
  const usLots = lotsAtLiveRate(localUs ? localUs.lots : apiLots, fxNow);
  const lotsLoaded = apiLots.every(l => us.fxByDate[istDate(Date.parse(l.date))] !== undefined);
  const usBase = usHeld && usP !== null ? computeUS({ Q: usHeld.Q, A: usHeld.A, lots: usLots, q: 0, p: usP, fxNow }) : null;

  let usCardModel: CardModel | null = null;
  let usNote: string | null = null;
  if (us.positions) {
    if (us.positions.source === 'unavailable') usNote = `Alpaca paper account unavailable (${us.positions.error?.message ?? 'no response'}).`;
    else if (!usHeld) {
      const placed = us.positions.pending_orders.map(o => o.created_at).sort()[0];
      usNote = placed ? `Awaiting first fill (orders placed ${fmtDate(istDate(Date.parse(placed)))})` : `No ${usSym ?? ''} position on the Alpaca paper account yet.`;
    } else if (us.fx && us.fx.rate === null) usNote = 'USD/INR feed unavailable';
    else if (!localUs && us.fills?.source === 'unavailable') usNote = INR_UNAVAILABLE_FILLS_ERROR;
    else if (fxNow !== null && usP !== null && (localUs || (us.fills && lotsLoaded))) {
      usCardModel =
        usCard({ symbol: usSym ?? '', Q: usHeld.Q, A: usHeld.A, lots: usLots, predatesWindow: localUs ? false : us.history?.predatesWindow ?? true, q: usQ, p: usP, fxNow })?.model ?? null;
    }
  }
  const usView: UsView = !us.positions
    ? { state: 'loading', symbol: usSym ?? '' }
    : usHeld && usP !== null
      ? {
          state: 'held',
          symbol: usSym ?? '',
          row: {
            qty: usHeld.Q,
            avgUsd: usHeld.A,
            avgInr: usBase?.inr?.inrAvg ?? null,
            ltp: usP,
            rUsd: usP / usHeld.A - 1,
            rInr: usBase?.inr?.rInr ?? null,
            currentInr: fxNow !== null ? usHeld.Q * usP * fxNow : null,
            local: !!localUs,
          },
          summary: {
            currentInr: fxNow !== null ? usHeld.Q * usP * fxNow : null,
            currentUsd: usHeld.Q * usP,
            fxNow,
            investedInr: usBase?.inr ? usHeld.Q * usBase.inr.inrAvg : null,
            rUsd: usP / usHeld.A - 1,
            rInr: usBase?.inr?.rInr ?? null,
          },
        }
      : { state: usHeld ? 'loading' : us.positions.source === 'unavailable' ? 'unavailable' : 'awaiting', symbol: usSym ?? '', message: usNote ?? undefined };

  const usClock = us.price?.market;
  const usVM: UsTicketVM | null = usSym
    ? {
        symbol: usSym,
        side,
        exchange: us.price?.exchange ?? null,
        price: usP,
        prevClose: us.price?.prev_close ?? null,
        lastTradeAt: us.price?.at ? Date.parse(us.price.at) || null : null,
        marketOpen: usClock ? usClock.is_open : null,
        fxNow,
        fxLoaded: !!us.fx,
        qtyText: usQtyText,
        onQtyText: setUsQtyText,
        onQtyStep: d => setUsQtyText(String(Math.max(0.1, +(usQ + d).toFixed(1)))),
        card: usCardModel,
        cardOpen,
        onToggleCard: () => setCardOpen(o => !o),
        note: usNote,
        marketNote: usClock && !usClock.is_open && usClock.next_open ? `US market opens ${fmtIstClock(Date.parse(usClock.next_open))}.` : null,
        // no Alpaca margin endpoint for a sale, and no exact order while the box is invalid: "—", never a typed figure
        required: side === 'SELL' || !usQtyOk ? null : usP !== null ? usQ * usP : null,
      }
    : null;

  // ---------------------------------------------------------------- source chips (truthful, per render)
  const chips: Chip[] = [];
  if (market === 'IN') {
    if (exMarket?.open) chips.push({ id: 'price', text: live.polling ? `Live ${exch} price · polling` : `Live ${exch} price`, state: 'live', title: 'Upstox LTP v3 + Market Data Feed V3 (WebSocket → /api/stream)' });
    else if (exMarket)
      chips.push({
        id: 'price',
        text: q0?.ltt ? `${exch} closed · last traded ${fmtLastTraded(q0.ltt)}` : `${exch} closed · last traded price`,
        state: 'closed',
        title: `Upstox ${exch} market status ${exMarket.status}; price = last traded (LTP v3 / feed snapshot)`,
      });
    else if (L !== null) chips.push({ id: 'price', text: `${exch} price`, state: 'off', title: `Upstox LTP v3 + Market Data Feed V3; ${exch} market status unavailable` });
    if (hold.data && hold.data.source !== 'unavailable' && hold.data.fetched_at) {
      const cached = hold.data.source === 'cache';
      chips.push({
        id: 'holdings',
        text: `${hold.data.label} · ${cached ? 'cached' : 'fetched'} ${fmtFetched(hold.data.fetched_at)}`,
        state: cached ? 'cached' : 'live',
        title: cached ? `${cacheReason(hold.data.error)} — showing data/cache written from GET /v2/portfolio/long-term-holdings` : 'Upstox Holdings API GET /v2/portfolio/long-term-holdings',
      });
    }
    // after a confirmed order the card and the row use this browser's update, so say so next to the holdings chip
    if (local && symbol)
      chips.push({ id: 'local', text: `${symbol} updated locally`, state: 'cached', title: 'Updated in this browser after the order — in production this comes from re-fetching holdings after the fill.' });
    if (inCard && tradesFor && histOk && inCard.variant !== 'mtf') {
      chips.push({
        id: 'trades',
        text: tradesFor.source === 'live' ? 'Trade history · last 3 FYs' : `Trade history · cached ${fmtFetched(tradesFor.fetched_at as string)}`,
        state: tradesFor.source === 'live' ? 'live' : 'cached',
        title: `Upstox Trade History GET /v2/charges/historical-trades${tradesFor.window ? ` from ${tradesFor.window.start_date}` : ''}`,
      });
    }
    // Upstox's Funds API answers only in its service hours (UDAPI100072 "accessible from 5:30 AM to 12:00 AM IST"):
    // say so on screen instead of leaving a bare "—"; the opening time is read from Upstox's own message.
    if (fundsInUse && fundsNote && funds.data?.error) {
      const opens = /from (\d{1,2}:\d{2}\s?[AP]M)/i.exec(funds.data.error.message)?.[1];
      chips.push({
        id: 'funds',
        text: funds.data.error.upstream_code === 'UDAPI100072' && opens ? `Upstox funds service closed · opens ${opens} IST` : 'Upstox funds unavailable',
        state: 'closed',
        title: `Upstox Funds API GET /v2/user/get-funds-and-margin: ${funds.data.error.message}`,
      });
    }
    // no chip while the button is "Add funds": no order can be sent from that screen
    if (flags.data?.sandbox_order && tab !== 'gtt' && !insufficient)
      chips.push({ id: 'sandbox', text: 'Sandbox order', state: 'live', title: 'Orders from this ticket go to the Upstox sandbox (api-sandbox.upstox.com)' });
  } else {
    if (us.positions?.source === 'live') chips.push({ id: 'alpaca', text: 'Alpaca paper', state: 'live', title: 'Alpaca paper positions, fills and IEX price' });
    if (localUs && usSym)
      chips.push({ id: 'local', text: `${usSym} updated locally`, state: 'cached', title: 'Updated in this browser after the order — Alpaca reports the real position after a fill.' });
    if (us.fx && us.fx.rate !== null) {
      // "Live" only while the feed/intraday value is fresh; a weekend's last tick or a daily close says when it is from.
      const asOf = us.fx.as_of ? Date.parse(us.fx.as_of) : NaN;
      const fresh = (us.fx.basis === 'feed' || us.fx.basis === 'intraday') && Number.isFinite(asOf) && Date.now() - asOf < 30 * 60_000;
      // PHASES Phase 7 + CPO Q2: the chip names the real Upstox instrument key (from the /api/fx response), on SPEC's wording.
      const fxSrc = `Upstox ${us.fx.instrument_key ?? 'USD/INR'}`;
      chips.push({
        id: 'fx',
        text: fresh
          ? `Live USD/INR (${fxSrc})`
          : us.fx.basis === 'daily_close'
            ? `USD/INR (${fxSrc})${us.fx.date ? ` · ${fmtDayMonth(us.fx.date)} close` : ''}`
            : `USD/INR (${fxSrc})${Number.isFinite(asOf) ? ` · ${`as of ${fmtLastTraded(asOf)} IST`.replace(/ /g, '\u00a0')}` : ''}`,
        state: fresh ? 'live' : 'closed',
        title: `${fxSrc} via ${us.fx.basis === 'feed' ? 'Market Data Feed V3' : us.fx.basis === 'intraday' ? 'intraday candles' : 'daily candles'}${Number.isFinite(asOf) ? ` · ${fmtIstStamp(asOf)}` : ''}`,
      });
    }
  }

  // ---------------------------------------------------------------- phone selector
  const mobOptions: MobOption[] = [
    ...holdings.map(h => ({ value: `IN:${h.trading_symbol}`, label: `${h.trading_symbol} — held, ${h.pnl < 0 ? 'at a loss' : 'in profit'}` })),
    ...watchItems.filter(w => !holdings.some(h => h.trading_symbol === w.symbol)).map(w => ({ value: `IN:${w.symbol}`, label: `${w.symbol} — not held (no card)` })),
    ...(usSym ? [{ value: `US:${usSym}`, label: `${usSym} — US Stocks` }] : []),
  ];
  const mobValue = market === 'US' && usSym ? `US:${usSym}` : `IN:${symbol ?? ''}`;

  // ---------------------------------------------------------------- exchange picker options (live LTP v3 / feed)
  const exchangeOptions = (sym: string): ExchangeOption[] => {
    const k = keysOf(sym);
    const opt = (ex: Exchange, ik: string | null): ExchangeOption[] =>
      ik ? [{ exchange: ex, series: ik.slice(ik.indexOf('_') + 1, ik.indexOf('|')), ltp: live.quotes[ik]?.last_price ?? null, cp: live.quotes[ik]?.cp ?? null }] : [];
    return [...opt('NSE', k.nse), ...opt('BSE', k.bse)];
  };

  // ---------------------------------------------------------------- review → order → receipt
  const onReview = async () => {
    if (reviewing) return;
    if (market === 'IN') {
      if (!symbol || !key || !prices || L === null) return;
      setReviewing(true);
      // GTT is never sent: the Upstox sandbox has no GTT, and a GTT must not become a regular order.
      const order =
        tab === 'gtt'
          ? notWired('GTT orders are not supported by the Upstox sandbox')
          : await postOrder({
              tab,
              side,
              symbol,
              instrument_key: key,
              quantity: q,
              order_type: priceMode === 'limit' ? 'LIMIT' : 'MARKET',
              price: priceMode === 'limit' ? prices.p : 0,
            });
      if (side === 'SELL') {
        // a sale is not an add-more: no Add-More lines, and the holdings table is never changed locally
        setReceipt(sellReceipt({ tab, symbol, exchange: exch, q, p: prices.p, order }));
        setReviewing(false);
        return;
      }
      const r = indiaReceipt({ tab, symbol, held: holding, q, p: prices.p, L, order, exchange: exch });
      setReceipt(r);
      if (r.updatesLocally) {
        const c = computeIndia({ Q, A: holding?.average_price ?? null, q, p: prices.p, ref: L });
        const today = istDate(Date.now());
        const sym = symbol;
        const nextHolding: Holding = { quantity: c.newQty, t1_quantity: 0, average_price: holding ? c.newAvg : prices.p };
        const trade: TradeRow = { trade_date: today, transaction_type: 'BUY', price: prices.p, quantity: q, isin: isin ?? '', symbol: sym, local: true };
        setPending(() => () =>
          setLocalIn(prev => ({
            ...prev,
            [sym]: { holding: nextHolding, trades: [...(prev[sym]?.trades ?? []), trade], orderIds: [...(prev[sym]?.orderIds ?? []), order.order_id ?? 'local'] },
          })),
        );
      }
      setReviewing(false);
    } else {
      if (!usSym || usP === null) return;
      if (side === 'SELL') {
        // US orders are never sent (CPO Q8); a sale is not an add-more, so the sheet has no Add-More lines
        setReceipt(usSellReceipt({ symbol: usSym, q: usQ, p: usP }));
        return;
      }
      const r = usReceipt({ symbol: usSym, held: usHeld ? { Q: usHeld.Q, A: usHeld.A, inrAvg: usBase?.inr?.inrAvg ?? null } : null, q: usQ, p: usP, fxNow });
      setReceipt(r);
      if (r.updatesLocally && usHeld) {
        // only an existing position is updated locally; with no Alpaca position nothing is simulated (SPEC)
        const newQty = usHeld.Q + usQ;
        const newA = (usHeld.Q * usHeld.A + usQ * usP) / newQty;
        const lot: UsLot = { date: new Date().toISOString(), qty: usQ, price: usP, fx: fxNow ?? NaN, fxDate: us.fx?.date ?? null, order_id: 'local', fxLive: us.fx?.basis === 'feed' || us.fx?.basis === 'intraday' };
        setPending(() => () => setLocalUs({ Q: newQty, A: newA, lots: [...usLots, lot] }));
      }
    }
  };
  // Upstox Pro sends "Add funds" to its funds page; this demo shows the real balance and never moves money.
  const onAddFunds = () =>
    setReceipt({
      title: 'Add funds',
      sub: `Available ${available !== null ? `₹ ${available.toFixed(2)}` : '—'} · Required ${required !== null ? `₹ ${required.toFixed(2)}` : '—'}`,
      label: null,
      lines: [],
      meta: 'Balance from the Upstox Funds API. Funds are added in the Upstox app; this demo never moves money.',
      metaTitle: 'Upstox Funds API GET /v2/user/get-funds-and-margin (equity.available_margin); Required = Margin API POST /v2/charges/margin',
      updatesLocally: false,
    });

  const onDone = () => {
    pending?.();
    setPending(null);
    setReceipt(null);
  };

  // ---------------------------------------------------------------- problems worth a banner
  const problems: string[] = [];
  if (inst.data?.error) problems.push(inst.data.error.message);
  if (hold.data?.error?.code === 'missing_env') problems.push(`${hold.data.error.key} is not set in .env.local — see HUMAN_TODO.md.`);
  else if (hold.data?.source === 'cache') problems.push(`${cacheReason(hold.data.error)} — showing holdings cached at ${fmtFetched(hold.data.fetched_at as string)}.${hold.data.error?.code === 'unauthorized' ? ' Refresh: node scripts/upstox-login.mjs (HUMAN_TODO.md).' : ''}`);
  else if (hold.data?.source === 'unavailable') problems.push(`Holdings unavailable: ${hold.data.error?.message ?? 'no response'}.`);
  if (live.error) problems.push(`Upstox market data: ${live.error}`);

  // Review needs a valid price and quantity box (priceInputOk / qtyOk / usQtyOk above) and, on a Regular/MTF BUY, both
  // Upstox answers for this exact order (ctaReady).
  const canReview = market === 'IN' ? !!(symbol && key && prices && priceInputOk && qtyOk && ctaReady) : usP !== null && usQtyOk;

  return (
    <div className="app">
      <Ticker indices={inst.data?.indices ?? []} quotes={live.quotes} />
      <TopBar holdingsPnl={holdingsPnl} positionsPnl={hold.data?.positions?.total_pnl ?? null} initials={hold.data?.initials ?? null} />
      {problems.length ? (
        <div className="banner" role="status">
          {problems.map(p => (
            <div key={p}>⚠ {p}</div>
          ))}
        </div>
      ) : null}
      <div className={`work${panelOpen ? ' panel-open' : ''}`}>
        <Watchlist name={inst.data?.watchlist.name ?? null} items={watchItems} quotes={live.quotes} selected={market === 'IN' && panelOpen ? symbol : null} onTrade={requestTrade} />
        <HoldingsPanel
          market={holdTab}
          onMarket={showHoldings}
          rows={inRows}
          state={holdingsState}
          message={holdingsMessage}
          selected={market === 'IN' && panelOpen ? symbol : null}
          onTrade={requestTrade}
          onUsTrade={openUsTicket}
          us={usView}
        />
        <OrderPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          cta={side === 'SELL' ? 'review_sell' : market === 'IN' && insufficient ? 'add_funds' : 'review_buy'}
          onAddFunds={onAddFunds}
          market={market}
          chips={chips}
          india={indiaVM}
          us={usVM}
          mobOptions={mobOptions}
          mobValue={mobValue}
          onMob={v => {
            const [m, s] = v.split(':');
            if (m === 'US') openUsTicket('BUY');
            else openTicket(s, 'BUY', keysOf(s).nse ? 'NSE' : 'BSE');
          }}
          onReview={onReview}
          reviewing={reviewing}
          canReview={canReview}
          addFundsReady={ctaReady}
        />
        <div className="rail">
          <button
            className={`cart${panelOpen ? ' on' : ''}`}
            aria-label={panelOpen ? 'Hide order panel' : 'Show order panel'}
            aria-pressed={panelOpen}
            onClick={() => symbol && setPanelOpen(o => !o)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9.5" cy="19.5" r="1.5" fill="currentColor" />
              <circle cx="17" cy="19.5" r="1.5" fill="currentColor" />
            </svg>
          </button>
          <div className="inf">i</div>
        </div>
      </div>
      {pick ? <ExchangeModal side={pick.side} symbol={pick.symbol} options={exchangeOptions(pick.symbol)} onPick={ex => openTicket(pick.symbol, pick.side, ex)} onClose={() => setPick(null)} /> : null}
      <ConfirmSheet receipt={receipt} onDone={onDone} />
    </div>
  );
}
