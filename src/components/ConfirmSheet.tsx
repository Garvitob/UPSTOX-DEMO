'use client';
import { Rich } from './AddMoreCard/AddMoreCard';
import type { ReceiptModel } from '@/lib/copy';

// "Review buy/sell order" confirmation (docs/SPEC.md → Confirmation sheet). Identical whether or not an order id came
// back; only the meta line differs. Markup mirrors the reference's .ov / .sheet.
export function ConfirmSheet({ receipt, onDone }: { receipt: ReceiptModel | null; onDone: () => void }) {
  return (
    <div className={`ov${receipt ? ' on' : ''}`} onClick={e => e.target === e.currentTarget && onDone()}>
      {receipt ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="rcTitle">
          <h3 id="rcTitle">{receipt.title}</h3>
          <div className="sub">{receipt.sub}</div>
          {receipt.label !== null || receipt.lines.length ? (
            <div className="r">
              {receipt.label !== null ? <div className="lbl">{receipt.label}</div> : null}
              <div>
                {receipt.lines.map((l, i) => (
                  <div key={i}>
                    <Rich segs={l} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <button className="ok" onClick={onDone} autoFocus>
            Done
          </button>
          <div className="meta" title={receipt.metaTitle}>
            {receipt.meta}
          </div>
        </div>
      ) : null}
    </div>
  );
}
