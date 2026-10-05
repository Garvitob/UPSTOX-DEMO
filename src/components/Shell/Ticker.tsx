'use client';
import { fmtExpiry, num, sgnNum } from '@/lib/format';
import type { IndexInfo } from '@/lib/types';
import type { LiveQuote } from '@/hooks/useLivePrice';

// NIFTY 50 / BANKNIFTY / SENSEX from LTP v3 + feed; change vs previous close (cp); next F&O expiry from the
// instrument master. A key without a price shows "—" (never a guessed value).
export function Ticker({ indices, quotes }: { indices: IndexInfo[]; quotes: Record<string, LiveQuote> }) {
  const now = Date.now();
  return (
    <div className="ticker">
      {indices.map(ix => {
        const q = quotes[ix.instrument_key];
        const exp = ix.expiries.find(e => e >= now);
        const chg = q && q.cp ? q.last_price - q.cp : null;
        const pc = q && q.cp ? (q.last_price / q.cp - 1) * 100 : null;
        return (
          <span key={ix.instrument_key}>
            <b>{ix.label}</b>
            <span className="px">{q ? num(q.last_price) : '—'}</span>
            {chg !== null && pc !== null ? (
              <span className={`chg${chg >= 0 ? ' pos' : ''}`}>
                {sgnNum(chg)} ({sgnNum(pc)}%)
              </span>
            ) : null}
            {exp ? <span className="exp">Exp. {fmtExpiry(exp)}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
