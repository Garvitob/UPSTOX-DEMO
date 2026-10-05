'use client';
import { useEffect } from 'react';
import { num, sgnNum } from '@/lib/format';

// Upstox Pro's "Exchange to Buy From" dialog (reference/screenshots/upstox-pro-exchange-modal.png): after Buy or Sell on
// a holding or watchlist row, the user picks NSE or BSE; the Place Order panel then opens on that exchange. Every
// price and change here is the live LTP v3 / feed quote of that exchange's instrument key.

export interface ExchangeOption {
  exchange: 'NSE' | 'BSE';
  series: string; // from the instrument key's segment: NSE_EQ → "EQ"
  ltp: number | null;
  cp: number | null; // previous close of that exchange
}

const cls = (n: number) => (n < 0 ? 'neg' : 'pos');

export function ExchangeModal(props: {
  side: 'BUY' | 'SELL';
  symbol: string;
  options: ExchangeOption[];
  onPick: (exchange: 'NSE' | 'BSE') => void;
  onClose: () => void;
}) {
  const { side, symbol, options, onPick, onClose } = props;
  const verb = side === 'BUY' ? 'buy' : 'sell';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="xm-ov" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="xm" role="dialog" aria-modal="true" aria-labelledby="xmTitle">
        <div className="xm-head">
          <button className="x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <h3 id="xmTitle">Exchange to {side === 'BUY' ? 'Buy' : 'Sell'} From</h3>
        </div>
        <p className="xm-q">
          Which exchange would you like to {verb} {symbol} {options[0]?.series ?? ''} from?
        </p>
        {options.map(o => {
          const chg = o.ltp !== null && o.cp ? o.ltp - o.cp : null;
          const pc = o.ltp !== null && o.cp ? (o.ltp / o.cp - 1) * 100 : null;
          return (
            <button key={o.exchange} className="xm-opt" data-ex={o.exchange} onClick={() => onPick(o.exchange)} autoFocus={o === options[0]}>
              <span className="ex">{o.exchange}</span>
              <span className="sym">
                {symbol} <span className="se">{o.series}</span>
              </span>
              <span className="px">
                <span className={chg === null ? '' : cls(chg)}>{o.ltp !== null ? num(o.ltp) : '—'}</span>
                <small>{chg !== null && pc !== null ? `${sgnNum(chg)}(${sgnNum(pc)}%)` : ' '}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
