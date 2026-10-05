'use client';
import { useEffect, useState } from 'react';
import { AddMoreCard } from '@/components/AddMoreCard/AddMoreCard';
import { SourceChips, type Chip } from '@/components/SourceChips';
import { gttCondition, pctFromTrigger, triggerAtPct } from '@/lib/compute';
import { fmtLastTraded, inr, num, sgnNum, usd } from '@/lib/format';
import type { CardModel } from '@/lib/copy';
import type { PriceMode, Tab } from '@/lib/compute';

// The Upstox Pro "Place Order" panel (reference/add-more-check-demo.html → .order; flow and footer per the human's
// pro.upstox.com screenshots in reference/screenshots/upstox-pro-*.png). It opens after Buy/Sell on a row and shows
// the ticket of the stock that was pressed: an Indian stock (holdings / watchlist, after the NSE/BSE pick) opens the
// Upstox ticket, a row of the US Stocks holdings tab opens the US ticket. ✕ closes it. The Add-More Check card sits
// directly under the MTF row of a BUY ticket. Every number comes from the props, which come from the APIs (LTP
// v3/feed, Holdings, Trade History, Margin API, Funds API, Alpaca, Upstox USD/INR).

export type Side = 'BUY' | 'SELL';
export type Exchange = 'NSE' | 'BSE';

export interface IndiaTicketVM {
  symbol: string;
  side: Side;
  onSide: (s: Side) => void; // GTT "Side [Buy | Sell]"
  openedSide: Side; // the Buy / Sell that opened the ticket: decides the tab list (Upstox's Regular/MTF have no Side)
  exchange: Exchange; // the exchange this ticket trades on (its LTP is L)
  onExchange: (ex: Exchange) => void;
  L: number | null; // LTP of the selected exchange
  cp: number | null; // previous close of the selected exchange
  nse: number | null; // NSE LTP (null when the stock is not listed there)
  bse: number | null; // BSE LTP (null when the stock is not listed there)
  ltt: number | null;
  marketOpen: boolean | null; // the selected exchange's market status
  tab: Tab;
  onTab: (t: Tab) => void;
  qtyText: string;
  onQtyText: (s: string) => void;
  onQtyStep: (d: number) => void;
  priceMode: PriceMode;
  onTogglePriceMode: () => void;
  limitText: string;
  onLimitText: (s: string) => void;
  triggerText: string;
  onTriggerText: (s: string) => void;
  tick: number | null; // instrument tick size (instrument master), for the GTT % box
  mtfPerShare: number | null; // Margin API, MTF, one share at L
  mtfBadge: string | null; // "3.2X"
  card: CardModel | null;
  cardNote: string | null; // shown in the card's place while position data loads / is unavailable
  cardOpen: boolean;
  onToggleCard: () => void;
  required: number | null; // Margin API (POST /v2/charges/margin) for this exact order
  requiredNote: string | null; // why Required shows "—" after a failed Margin API answer (hover)
  withMtf: number | null;
  available: number | null; // Funds API (equity.available_margin)
  fundsNote: string | null; // why the balance is not shown (funds service closed, token, …)
  insufficient: boolean; // BUY on Regular/MTF needs more than the available funds (Upstox: "Add funds")
  onRefresh: () => void; // ⟳ next to Required: refetch margin and funds
}

export interface UsTicketVM {
  symbol: string;
  side: Side;
  exchange: string | null;
  price: number | null;
  prevClose: number | null;
  lastTradeAt: number | null; // IEX latest trade time (epoch ms)
  marketOpen: boolean | null; // Alpaca clock
  fxNow: number | null;
  fxLoaded: boolean; // the FX request has answered (so a null rate really means unavailable)
  qtyText: string;
  onQtyText: (s: string) => void;
  onQtyStep: (d: number) => void;
  card: CardModel | null;
  cardOpen: boolean;
  onToggleCard: () => void;
  note: string | null; // "Awaiting first fill (…)" / "USD/INR feed unavailable" / Alpaca unavailable
  marketNote: string | null; // "US market opens …" when the US market is closed
  required: number | null;
}

const cls = (n: number) => (n < 0 ? 'neg' : 'pos');

/** The small ⇄ square beside each Upstox ticket input (display only in this demo). */
const Swap = () => (
  <span className="sw" aria-hidden="true">
    ⇄
  </span>
);

function Stepper(props: { value: string; onText: (s: string) => void; onStep: (d: number) => void; step: number; err?: boolean; decimal?: boolean }) {
  const { value, onText, onStep, step, err, decimal } = props;
  return (
    <div className={`stepper${err ? ' err' : ''}`}>
      <button aria-label="Decrease quantity" onClick={() => onStep(-step)}>
        −
      </button>
      <input
        aria-label="Quantity"
        value={value}
        inputMode={decimal ? 'decimal' : 'numeric'}
        maxLength={decimal ? 8 : 7}
        onChange={e => onText(e.target.value.replace(decimal ? /[^\d.]/g : /[^\d]/g, ''))}
      />
      <button aria-label="Increase quantity" onClick={() => onStep(step)}>
        +
      </button>
    </div>
  );
}

/** GTT "Place order · If price is below/above": trigger ⇄ distance from the live price in %, both on the tick grid. */
function GttTrigger({ v }: { v: IndiaTicketVM }) {
  const [pctEdit, setPctEdit] = useState<string | null>(null);
  const T = parseFloat(v.triggerText.replace(/,/g, ''));
  const at = v.L !== null ? pctFromTrigger(v.L, T) : null;
  // the condition is the user's choice (⌄ toggle); a trigger typed in the ₹ box, or reset for a new stock, moves it only
  // when it lands strictly on the other side of the live price — never while the % box is being typed in
  const [dir, setDir] = useState<'below' | 'above'>(() => gttCondition('below', v.L, T));
  // pctEdit is read but deliberately not a dependency: the condition follows a trigger change, never the end of a % edit
  // (blurring the % box must not re-derive the condition from a trigger that equals the live price).
  useEffect(() => {
    if (pctEdit === null) setDir(d => gttCondition(d, v.L, parseFloat(v.triggerText.replace(/,/g, ''))));
  }, [v.triggerText, v.L]);
  /** % → trigger on the tick grid; an unusable % (e.g. 100) empties the trigger, which disables Review until it is fixed. */
  const setFromPct = (text: string, d: 'below' | 'above') => {
    if (v.L === null || text === '') return;
    const p = parseFloat(text);
    const t = Number.isFinite(p) ? triggerAtPct(v.L, p, d, v.tick) : null;
    v.onTriggerText(t !== null ? t.toFixed(2) : '');
  };
  return (
    <>
      <div className="gtt-po">
        <span className="t">Place order</span>
        <button
          className="cond"
          title="Switch the trigger to the other side of the live price"
          onClick={() => {
            const next = dir === 'below' ? 'above' : 'below';
            setDir(next);
            setFromPct(at ? at.pct.toFixed(2) : '0.25', next);
          }}
        >
          If price is {dir} <span className="cv">⌄</span>
        </button>
        <span className="q" aria-hidden="true">
          ?
        </span>
      </div>
      <div className="gtt-in">
        <div className="pbox on">
          <span className="cur">₹</span>
          <input aria-label="Trigger price" value={v.triggerText} inputMode="decimal" onChange={e => v.onTriggerText(e.target.value)} />
        </div>
        <span className="sw2" aria-hidden="true">
          ⇄
        </span>
        <div className="pbox on">
          <input
            aria-label="Trigger distance in percent"
            value={pctEdit ?? (at ? at.pct.toFixed(2) : '')}
            inputMode="decimal"
            onChange={e => {
              const t = e.target.value.replace(/[^\d.]/g, '');
              setPctEdit(t);
              setFromPct(t, dir);
            }}
            onBlur={() => setPctEdit(null)}
          />
          <span className="cur">%</span>
        </div>
      </div>
    </>
  );
}

function IndiaTicket({ v, chips }: { v: IndiaTicketVM; chips: Chip[] }) {
  const chg = v.L !== null && v.cp ? v.L - v.cp : null;
  const pc = v.L !== null && v.cp ? (v.L / v.cp - 1) * 100 : null;
  const closed = v.marketOpen === false;
  const gtt = v.tab === 'gtt';
  const mtfRow =
    v.tab === 'mtf' || v.side === 'SELL' ? null : (
      <div className="mtfrow">
        <span className="cb" />
        {v.mtfPerShare !== null ? `Buy for ${inr(v.mtfPerShare)}/share with MTF` : 'Buy with MTF'} {v.mtfBadge ? <span className="b">{v.mtfBadge}</span> : null}
        <span className="i">ⓘ</span>
      </div>
    );
  const card =
    v.side === 'SELL' ? null : v.card ? (
      <AddMoreCard model={v.card} open={v.cardOpen} onToggle={v.onToggleCard} />
    ) : v.cardNote ? (
      <div className="amc-note">{v.cardNote}</div>
    ) : null;
  return (
    <>
      <div className="o-stock">
        <div>
          <div className="nm">{v.symbol}</div>
          <div className={`ch ${chg === null ? '' : cls(chg)}`}>{chg !== null && pc !== null ? `${sgnNum(chg)} (${sgnNum(pc)}%)` : ' '}</div>
        </div>
        <div className="px">
          {v.nse !== null || v.exchange === 'NSE' ? (
            <button className="exr" data-ex="NSE" aria-pressed={v.exchange === 'NSE'} onClick={() => v.onExchange('NSE')}>
              {v.exchange === 'NSE' ? <b>{v.nse !== null ? num(v.nse) : '—'}</b> : v.nse !== null ? num(v.nse) : '—'} NSE
              <span className={`radio${v.exchange === 'NSE' ? ' on' : ''}`} />
            </button>
          ) : null}
          {v.bse !== null ? (
            <>
              {v.nse !== null || v.exchange === 'NSE' ? <br /> : null}
              <button className="exr" data-ex="BSE" aria-pressed={v.exchange === 'BSE'} onClick={() => v.onExchange('BSE')}>
                {v.exchange === 'BSE' ? <b>{num(v.bse)}</b> : num(v.bse)} BSE
                <span className={`radio${v.exchange === 'BSE' ? ' on' : ''}`} />
              </button>
            </>
          ) : null}
          {closed && v.ltt ? (
            <>
              <br />
              <span className="ltt">Last traded {fmtLastTraded(v.ltt)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="o-tabs">
        {((v.openedSide === 'SELL' ? ['regular', 'gtt'] : ['regular', 'gtt', 'mtf']) as Tab[]).map(t => (
          <button key={t} data-tab={t} className={v.tab === t ? 'on' : ''} onClick={() => v.onTab(t)}>
            {t === 'regular' ? 'Regular' : t === 'gtt' ? 'GTT' : 'MTF'}
            {t === 'mtf' && v.mtfBadge ? <span className="badge">{v.mtfBadge}</span> : null}
          </button>
        ))}
      </div>
      <div className="o-body">
        <div className="prod">
          <button className="on">Delivery (Longterm)</button>
          <button>Intraday (Same day)</button>
        </div>
        <div className="qp">
          <div className="f">
            <div className="lbl">
              <span className="pl">Quantity ⌄</span>
            </div>
            <div className="ctl">
              <Stepper value={v.qtyText} onText={v.onQtyText} onStep={v.onQtyStep} step={1} err={v.insufficient} />
              <Swap />
            </div>
          </div>
          {gtt ? (
            <div className="f">
              <div className="lbl">
                <span>Side</span>
              </div>
              <div className="side">
                <button className={v.side === 'BUY' ? 'on buy' : ''} aria-pressed={v.side === 'BUY'} onClick={() => v.onSide('BUY')}>
                  Buy
                </button>
                <button className={v.side === 'SELL' ? 'on sell' : ''} aria-pressed={v.side === 'SELL'} onClick={() => v.onSide('SELL')}>
                  Sell
                </button>
              </div>
            </div>
          ) : (
            <div className="f">
              <div className="lbl">
                <button className="pl" title={v.priceMode === 'market' ? 'Switch to a limit price' : 'Switch to market'} onClick={v.onTogglePriceMode}>
                  {v.priceMode === 'market' ? 'Market' : 'Limit'} ⌄
                </button>
                <span className="trg">+ Trigger</span>
              </div>
              <div className="ctl">
                <div className={`pbox${v.priceMode === 'limit' ? ' on' : ''}`}>
                  <input aria-label="Limit price" value={v.priceMode === 'market' ? '' : v.limitText} inputMode="decimal" onChange={e => v.onLimitText(e.target.value)} />
                </div>
                <Swap />
              </div>
            </div>
          )}
        </div>
        {v.insufficient ? (
          <div className="funds-msg" role="status">
            You&apos;ve insufficient funds to buy {v.symbol}. To continue, add funds.
          </div>
        ) : null}
        {mtfRow}
        {card}
        {gtt ? <GttTrigger v={v} /> : null}
        {gtt ? (
          <div className="tc">
            I accept the <u>T&amp;C</u> and agree that the execution of the triggered order is not guaranteed.
          </div>
        ) : null}
        {gtt ? null : (
          <div className="acc" style={{ marginTop: 12 }}>
            Market depth ✎ <span className="ch">⌄</span>
          </div>
        )}
        {gtt ? null : (
          <div className="acc">
            <span>
              Additional settings<small>Add validity &amp; disclosed quantity.</small>
            </span>
            <span className="ch">⌄</span>
          </div>
        )}
        {closed && !gtt ? (
          <div className="note">
            <span className="dot" />
            Markets are closed. Order will be placed during the next trading session.
          </div>
        ) : null}
      </div>
      <SourceChips chips={chips} />
      <div className="o-foot">
        <span className="req" title={v.requiredNote ?? undefined}>
          <u>Required:</u> {v.required !== null ? `₹ ${v.required.toFixed(2)}` : '—'}{' '}
          <button className="rf" aria-label="Refresh required margin and available funds" onClick={v.onRefresh}>
            ⟳
          </button>
        </span>
        {gtt && v.side === 'BUY' ? (
          v.withMtf !== null ? <span className="mtf">With MTF: ₹ {v.withMtf.toFixed(2)}</span> : null
        ) : (
          <span className={`avail${v.insufficient ? ' neg' : ''}`} title={v.fundsNote ?? 'Upstox Funds API GET /v2/user/get-funds-and-margin'}>
            Available: {v.available !== null ? `₹ ${v.available.toFixed(2)}` : '—'}
          </span>
        )}
      </div>
    </>
  );
}

function UsTicket({ v, chips }: { v: UsTicketVM; chips: Chip[] }) {
  const chg = v.price !== null && v.prevClose ? v.price - v.prevClose : null;
  const pc = v.price !== null && v.prevClose ? (v.price / v.prevClose - 1) * 100 : null;
  return (
    <>
      <div className="o-stock">
        <div>
          <div className="nm">{v.symbol}</div>
          <div className={`ch ${chg === null ? '' : cls(chg)}`}>{chg !== null && pc !== null ? `${sgnNum(chg)} (${sgnNum(pc)}%)` : ' '}</div>
        </div>
        <div className="px">
          <b>{v.price !== null ? num(v.price) : '—'}</b> USD{v.exchange ? ` · ${v.exchange}` : ''}
          <span className="radio on" />
          <br />
          <span style={{ color: 'var(--ink-3)' }}>
            {v.fxNow === null && v.fxLoaded ? 'USD/INR feed unavailable' : v.price !== null && v.fxNow !== null ? `≈ ${inr(v.price * v.fxNow, 0)} at ₹${num(v.fxNow)}/$` : ' '}
          </span>
          {v.marketOpen === false && v.lastTradeAt ? (
            <>
              <br />
              <span className="ltt">Last traded {fmtLastTraded(v.lastTradeAt)} IST</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="o-tabs">
        <button className="on">Regular</button>
        <button>Limit</button>
        {v.side === 'BUY' ? <button>Recurring</button> : null}
      </div>
      <div className="o-body">
        <div className="prod">
          <button className="on">Delivery</button>
          <button>Notional ($)</button>
        </div>
        <div className="qp">
          <div className="f">
            <div className="lbl">
              <span className="pl">Quantity (fractional) ⌄</span>
            </div>
            <div className="ctl">
              <Stepper value={v.qtyText} onText={v.onQtyText} onStep={v.onQtyStep} step={0.5} decimal />
              <Swap />
            </div>
          </div>
          <div className="f">
            <div className="lbl">
              <span className="pl">Market ⌄</span>
            </div>
            <div className="ctl">
              <div className="pbox">
                <input aria-label="Market price" value={v.price !== null ? num(v.price) : ''} disabled />
              </div>
              <Swap />
            </div>
          </div>
        </div>
        {v.side === 'SELL' ? null : v.card ? <AddMoreCard model={v.card} open={v.cardOpen} onToggle={v.onToggleCard} /> : v.note ? <div className="amc-note">{v.note}</div> : null}
        <div className="acc" style={{ marginTop: 12 }}>
          Market depth <span className="ch">⌄</span>
        </div>
        {v.marketNote ? (
          <div className="note">
            <span className="dot" />
            {v.marketNote}
          </div>
        ) : null}
      </div>
      <SourceChips chips={chips} />
      <div className="o-foot">
        <span className="req">
          <u>Required:</u> {v.required !== null ? `${usd(v.required)}${v.fxNow !== null && v.required > 0 ? ` (≈ ${inr(v.required * v.fxNow, 0)})` : ''}` : '—'}
        </span>
      </div>
    </>
  );
}

export interface MobOption {
  value: string;
  label: string;
}

export function OrderPanel(props: {
  open: boolean; // desktop: the panel shows only after Buy/Sell on a row (always shown on a phone)
  onClose: () => void;
  cta: 'review_buy' | 'review_sell' | 'add_funds';
  onAddFunds: () => void;
  market: 'IN' | 'US'; // the market of the stock that was pressed, never a toggle in the panel
  chips: Chip[];
  india: IndiaTicketVM | null;
  us: UsTicketVM | null;
  mobOptions: MobOption[];
  mobValue: string;
  onMob: (v: string) => void;
  onReview: () => void;
  reviewing: boolean;
  canReview: boolean;
  addFundsReady: boolean; // both Upstox answers for this exact order are in (Required + Available)
}) {
  const { open, onClose, cta, onAddFunds, market, chips, india, us, mobOptions, mobValue, onMob, onReview, reviewing, canReview, addFundsReady } = props;
  return (
    <section className={`order${open ? '' : ' closed'}`} aria-label="Place Order" data-mkt={market}>
      <div className="mob-only">
        <select aria-label="Stock" value={mobValue} onChange={e => onMob(e.target.value)}>
          {mobOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="o-head">
        Place Order
        <span className="ic">
          <svg className="pin" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10.5 1.5l4 4-1.6.6-2.4 2.4.4 3.6-1.1 1.1L6.6 10l-3.9 3.9-.7-.7L5.9 9.3 2.7 6.1l1.1-1.1 3.6.4 2.4-2.4z" fill="currentColor" />
          </svg>
          <button className="x" aria-label="Close order panel" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      {market === 'IN' && india ? <IndiaTicket v={india} chips={chips} /> : null}
      {market === 'US' && us ? <UsTicket v={us} chips={chips} /> : null}
      {(market === 'IN' && !india) || (market === 'US' && !us) ? (
        <div className="o-body">
          <div className="amc-note">{market === 'IN' ? 'Loading your Upstox holdings and prices…' : 'Loading the Alpaca paper account…'}</div>
        </div>
      ) : null}
      {cta === 'add_funds' ? (
        <button className="review addfunds" onClick={onAddFunds} disabled={!addFundsReady}>
          Add funds
        </button>
      ) : (
        <button className={`review${cta === 'review_sell' ? ' sell' : ''}`} onClick={onReview} disabled={reviewing || !canReview}>
          {reviewing ? 'Placing order…' : cta === 'review_sell' ? 'Review sell order' : 'Review buy order'}
        </button>
      )}
    </section>
  );
}
