'use client';
import { num, sgnNum } from '@/lib/format';
import type { LiveQuote } from '@/hooks/useLivePrice';

export interface WatchItem {
  symbol: string;
  label: string; // "NSE EQ" / "BSE B"
  key: string; // instrument key used for the price
}

const cls = (n: number) => (n < 0 ? 'neg' : 'pos');

// Left watchlist: the human's own Upstox watchlist symbols (data/watchlist.json, Upstox has no watchlist API)
// followed by the holdings. Every price is LTP v3 / feed; a symbol without a fetched price shows "—".
export function Watchlist({
  name,
  items,
  quotes,
  selected,
  onTrade,
}: {
  name: string | null;
  items: WatchItem[];
  quotes: Record<string, LiveQuote>;
  selected: string | null;
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
}) {
  return (
    <aside className="watch">
      <div className="watch-tabs">
        <span>‹</span>
        <span className="t">1</span>
        <span>＋</span>
        <span style={{ marginLeft: 'auto' }}>⋮</span>
      </div>
      <div className="watch-head" style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', alignItems: 'center' }}>
        <span className="name">{name ?? 'Watchlist'}</span>
        <span className="cnt">{items.length} / 200</span>
        <span className="ic" style={{ justifySelf: 'end' }}>
          <span>⋮</span>
          <span>≡</span>
          <span className="add">+</span>
        </span>
        <span className="by">by You</span>
      </div>
      <div className="wl">
        {items.map(w => {
          const q = quotes[w.key];
          const chg = q && q.cp ? q.last_price - q.cp : null;
          const pc = q && q.cp ? (q.last_price / q.cp - 1) * 100 : null;
          return (
            <div key={w.key} className={`row${selected === w.symbol ? ' sel' : ''}`} data-sym={w.symbol}>
              <div>
                <div className="sym">{w.symbol}</div>
                <div className="ex">{w.label}</div>
              </div>
              <div className="r">
                <div className={`px ${chg === null ? '' : cls(chg)}`}>{q ? num(q.last_price) : '—'}</div>
                <div className={`ch ${chg === null ? '' : cls(chg)}`}>{chg !== null && pc !== null ? `${sgnNum(chg)} (${sgnNum(pc)}%)` : ''}</div>
              </div>
              {/* Upstox Pro watchlist hover: B / S open the exchange picker, then the Place Order panel */}
              <span className="wl-act">
                <button className="b" aria-label={`Buy ${w.symbol}`} onClick={() => onTrade(w.symbol, 'BUY')}>
                  B
                </button>
                <button className="s" aria-label={`Sell ${w.symbol}`} onClick={() => onTrade(w.symbol, 'SELL')}>
                  S
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
