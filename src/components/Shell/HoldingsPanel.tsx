'use client';
import { inr, num, pct, qty as fmtQty, sgnNum, usd } from '@/lib/format';

export interface InRow {
  symbol: string;
  Q: number;
  A: number | null;
  invested: number | null; // Upstox's Invested: quantity × last_price − pnl of the Holdings snapshot (+ session buys)
  L: number | null; // live price (LTP v3 / feed)
  cp: number | null; // previous close
  local: { orderId: string | null } | null; // set after a confirmed order in this session
  localBuys: { qty: number; price: number }[]; // this session's confirmed buys (already included in Q)
}

export interface UsView {
  state: 'loading' | 'unavailable' | 'awaiting' | 'held';
  symbol: string;
  message?: string; // awaiting / unavailable text
  row?: { qty: number; avgUsd: number; avgInr: number | null; ltp: number; rUsd: number; rInr: number | null; currentInr: number | null; local: boolean };
  summary?: { currentInr: number | null; currentUsd: number; fxNow: number | null; investedInr: number | null; rUsd: number; rInr: number | null };
}

const cls = (n: number) => (n < 0 ? 'neg' : 'pos');

/**
 * Upstox Pro's row hover actions (reference/screenshots/upstox-pro-row-buy-sell-hover.png): Buy, Sell and More sit
 * at the right end of the hovered row. Buy/Sell open the exchange picker, then the Place Order panel.
 */
function RowActions({ symbol, onBuy, onSell }: { symbol: string; onBuy: () => void; onSell?: () => void }) {
  return (
    <span className="row-act">
      <button className="b" onClick={onBuy} aria-label={`Buy ${symbol}`}>
        Buy
      </button>
      {onSell ? (
        <button className="s" onClick={onSell} aria-label={`Sell ${symbol}`}>
          Sell
        </button>
      ) : null}
      <button className="m" aria-label="More options" title="More options">
        ⋮
      </button>
    </span>
  );
}

/**
 * Day P&L: shares held at the previous close move from it; shares bought in this session move from their order
 * price and stay out of the previous-close base (a buy today never carries yesterday's fall).
 */
function dayOf(r: InRow): { day: number; base: number } | null {
  if (r.L === null || !r.cp) return null;
  const L = r.L;
  const prevQ = Math.max(0, r.Q - r.localBuys.reduce((s, b) => s + b.qty, 0));
  return { day: (L - r.cp) * prevQ + r.localBuys.reduce((s, b) => s + (L - b.price) * b.qty, 0), base: r.cp * prevQ };
}

function Big({ v }: { v: number }) {
  const [a, b] = num(v).split('.');
  return (
    <div className="big">
      {a}
      <small>.{b}</small>
    </div>
  );
}

function IndiaSummary({ rows }: { rows: InRow[] }) {
  const priced = rows.filter(r => r.L !== null);
  if (rows.length === 0 || priced.length !== rows.length) return <div className="summary" />;
  const allAvg = rows.every(r => r.A !== null && r.invested !== null); // an average missing after a corporate action makes invested unknowable
  const current = rows.reduce((s, r) => s + r.Q * (r.L as number), 0);
  const invested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const total = current - invested;
  const day = rows.reduce((s, r) => s + (dayOf(r)?.day ?? 0), 0);
  const prev = rows.reduce((s, r) => s + (dayOf(r)?.base ?? 0), 0);
  return (
    <div className="summary">
      <div className="cv">
        <div className="lbl">Current value</div>
        <Big v={current} />
      </div>
      <div className="st">
        <div className="lbl">Invested</div>
        <div className="v">{allAvg ? num(invested) : '—'}</div>
      </div>
      <div className="st">
        <div className="lbl">Total P&amp;L</div>
        {allAvg ? (
          <div className={`v ${cls(total)}`}>
            {sgnNum(total)} <span className="p">({sgnNum(invested ? (total / invested) * 100 : 0)}%)</span>
          </div>
        ) : (
          <div className="v">—</div>
        )}
      </div>
      <div className="st">
        <div className="lbl">Day&apos;s P&amp;L ‹›</div>
        <div className={`v ${cls(day)}`}>
          {sgnNum(day)} <span className="p">({sgnNum(prev ? (day / prev) * 100 : 0)}%)</span>
        </div>
      </div>
    </div>
  );
}

function IndiaTable({
  rows,
  selected,
  onTrade,
  state,
  message,
}: {
  rows: InRow[];
  selected: string | null;
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
  state: 'loading' | 'ok' | 'unavailable';
  message: string;
}) {
  return (
    <div style={{ overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Symbol ({rows.length}) ↑</th>
            <th>Qty.</th>
            <th>Avg. price</th>
            <th>LTP</th>
            <th>Day P&amp;L</th>
            <th>Day %</th>
            <th>Overall P&amp;L</th>
            <th>Overall %</th>
            <th>Current</th>
            <th>Invested</th>
          </tr>
        </thead>
        <tbody>
          {state !== 'ok' ? (
            <tr className="msg">
              <td colSpan={10}>{message}</td>
            </tr>
          ) : null}
          {rows.map(r => {
            const L = r.L;
            const day = dayOf(r)?.day ?? null;
            const dayPc = L !== null && r.cp ? (L / r.cp - 1) * 100 : null;
            const overall = L !== null && r.A ? (L - r.A) * r.Q : null;
            const overallPc = L !== null && r.A ? (L / r.A - 1) * 100 : null;
            return (
              <tr key={r.symbol} className={selected === r.symbol ? 'sel' : ''} data-sym={r.symbol}>
                <td>
                  {r.symbol}
                  {r.local ? (
                    <span className="local-line">
                      <span className="local-tag" title="Updated in this browser after the order — in production this comes from re-fetching holdings after the fill.">
                        updated locally
                      </span>
                    </span>
                  ) : null}
                </td>
                <td>{r.Q}</td>
                <td>{r.A ? num(r.A) : '—'}</td>
                <td className={dayPc === null ? '' : cls(dayPc)}>{L === null ? '—' : num(L)}</td>
                <td className={day === null ? '' : cls(day)}>{day === null ? '—' : num(day)}</td>
                <td className={dayPc === null ? '' : cls(dayPc)}>{dayPc === null ? '—' : `${sgnNum(dayPc)}%`}</td>
                <td className={overall === null ? '' : cls(overall)}>{overall === null ? '—' : sgnNum(overall)}</td>
                <td className={overallPc === null ? '' : cls(overallPc)}>{overallPc === null ? '—' : `${sgnNum(overallPc)}%`}</td>
                <td>{L === null ? '—' : num(r.Q * L)}</td>
                <td className="act-cell">
                  {r.invested !== null ? num(r.invested) : '—'}
                  <RowActions symbol={r.symbol} onBuy={() => onTrade(r.symbol, 'BUY')} onSell={() => onTrade(r.symbol, 'SELL')} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsPart({ us, onUsTrade }: { us: UsView; onUsTrade: (side: 'BUY' | 'SELL') => void }) {
  const s = us.summary;
  return (
    <>
      <div className="summary">
        {s ? (
          <>
            <div className="cv">
              <div className="lbl">Current value</div>
              <div className="big">{s.currentInr !== null ? inr(s.currentInr, 0) : usd(s.currentUsd)}</div>
              <div className="lbl" style={{ marginTop: 2 }}>
                {usd(s.currentUsd)}
                {s.fxNow !== null ? ` · at ₹${num(s.fxNow)}/$` : ''}
              </div>
            </div>
            <div className="st">
              <div className="lbl">Invested (₹, at buy-date rates)</div>
              <div className="v">{s.investedInr !== null ? inr(s.investedInr, 0) : '—'}</div>
            </div>
            <div className="st">
              <div className="lbl">Return in $</div>
              <div className={`v ${cls(s.rUsd)}`}>
                {s.rUsd < 0 ? '' : '+'}
                {pct(s.rUsd)} {s.rUsd < 0 ? '↓' : '↑'}
              </div>
            </div>
            <div className="st">
              <div className="lbl">Return in ₹</div>
              <div className={`v ${s.rInr === null ? '' : cls(s.rInr)}`}>
                {s.rInr === null ? '—' : `${s.rInr < 0 ? '' : '+'}${pct(s.rInr)} ${s.rInr < 0 ? '↓' : '↑'}`}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div style={{ overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Symbol ({us.row ? 1 : 0})</th>
              <th>Qty.</th>
              <th>Avg. price ($)</th>
              <th>Avg. price (₹)</th>
              <th>LTP ($)</th>
              <th>Return $</th>
              <th>Return ₹</th>
              <th>Current (₹)</th>
            </tr>
          </thead>
          <tbody>
            {us.row ? (
              <tr data-sym={us.symbol}>
                <td>
                  {us.symbol}
                  {us.row.local ? (
                    <span className="local-line">
                      <span className="local-tag" title="Updated in this browser after the order — Alpaca reports the real position after a fill.">
                        updated locally
                      </span>
                    </span>
                  ) : null}
                </td>
                <td>{fmtQty(us.row.qty)}</td>
                <td>{num(us.row.avgUsd)}</td>
                <td>{us.row.avgInr !== null ? num(us.row.avgInr, 0) : '—'}</td>
                <td className={cls(us.row.rUsd)}>{num(us.row.ltp)}</td>
                <td className={cls(us.row.rUsd)}>{`${us.row.rUsd < 0 ? '-' : '+'}${pct(us.row.rUsd)}`}</td>
                <td className={us.row.rInr === null ? '' : cls(us.row.rInr)}>{us.row.rInr === null ? '—' : `${us.row.rInr < 0 ? '-' : '+'}${pct(us.row.rInr)}`}</td>
                <td className="act-cell">
                  {us.row.currentInr !== null ? num(us.row.currentInr, 0) : '—'}
                  <RowActions symbol={us.symbol} onBuy={() => onUsTrade('BUY')} onSell={() => onUsTrade('SELL')} />
                </td>
              </tr>
            ) : (
              <tr className="msg">
                <td colSpan={8} className="act-cell">
                  {us.message ?? 'Loading Alpaca paper account…'}
                  {us.symbol && us.state === 'awaiting' ? <RowActions symbol={us.symbol} onBuy={() => onUsTrade('BUY')} /> : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function HoldingsPanel(props: {
  market: 'IN' | 'US';
  onMarket: (m: 'IN' | 'US') => void;
  rows: InRow[];
  state: 'loading' | 'ok' | 'unavailable';
  message: string;
  selected: string | null;
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
  onUsTrade: (side: 'BUY' | 'SELL') => void;
  us: UsView;
}) {
  const { market, onMarket, rows, state, message, selected, onTrade, onUsTrade, us } = props;
  return (
    <main className="main">
      <div className="card">
        <div className="htabs">
          <button className={`tab${market === 'IN' ? ' on' : ''}`} data-mkt="IN" onClick={() => onMarket('IN')}>
            Stocks ({rows.length})
          </button>
          <button className="tab">Mutual Funds</button>
          <button className={`tab${market === 'US' ? ' on' : ''}`} data-mkt="US" onClick={() => onMarket('US')}>
            US Stocks ({us.row ? 1 : 0})
          </button>
          <span className="ic">
            <span>⟳</span>
            <span>⤡</span>
            <span>⤢</span>
          </span>
        </div>
        <div className="tools">
          <span className="btn-o">⚲</span>
          <span className="btn-o">Sectors ▾</span>
          <span className="ic">
            <span>⌕</span>
            <span>⋮</span>
            <span>👁</span>
          </span>
        </div>
        {market === 'IN' ? (
          <>
            <IndiaSummary rows={rows} />
            <IndiaTable rows={rows} selected={selected} onTrade={onTrade} state={state} message={message} />
          </>
        ) : (
          <UsPart us={us} onUsTrade={onUsTrade} />
        )}
      </div>
    </main>
  );
}
