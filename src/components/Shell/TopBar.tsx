'use client';
import { num } from '@/lib/format';

const tone = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero');

// Top bar: holdings P&L (sum of (LTP − average) × qty over real holdings), positions P&L (Upstox short-term
// positions), avatar initials from the Upstox profile. Unknown values render "—".
export function TopBar({ holdingsPnl, positionsPnl, initials }: { holdingsPnl: number | null; positionsPnl: number | null; initials: string | null }) {
  return (
    <header className="topbar">
      <div className="logo">up</div>
      <span className="chev">▾</span>
      <div className="pnl">
        <span>
          Hol. Total P&amp;L <span className={holdingsPnl === null ? 'zero' : tone(holdingsPnl)}>{holdingsPnl === null ? '—' : num(holdingsPnl)}</span>
        </span>
        <span>
          Pos. Total P&amp;L: <span className={positionsPnl === null ? 'zero' : tone(positionsPnl)}>{positionsPnl === null ? '—' : num(positionsPnl)}</span>
        </span>
        <span style={{ color: 'var(--ink-3)' }}>👁</span>
      </div>
      <nav className="nav">
        <span>Home</span>
        <span>My List</span>
        <span>Orders</span>
        <span>Positions</span>
        <span className="on">Holdings</span>
        <span>More ▾</span>
        <div className="search">
          ⌕ <span>Search</span>
        </div>
        <div className="funds">▭ Funds</div>
        <div className="avatar">{initials ?? ''}</div>
        <span style={{ color: 'var(--ink-3)' }}>⋮⋮⋮</span>
      </nav>
    </header>
  );
}
