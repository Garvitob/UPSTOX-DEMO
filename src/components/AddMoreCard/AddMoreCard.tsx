'use client';
import { Fragment, useEffect, useRef } from 'react';
import type { CardModel, Chain, ChainPart, KvRow, Seg } from '@/lib/copy';

// The Add-More Check card (docs/SPEC.md). Markup mirrors reference/add-more-check-demo.html (.amc …) so the
// ported CSS renders it identically. All text comes from src/lib/copy.ts; this component only lays it out.

export function Rich({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (typeof s === 'string' ? <Fragment key={i}>{s}</Fragment> : <b key={i}>{s.b}</b>))}
    </>
  );
}

function Part({ p }: { p: ChainPart }) {
  if (typeof p === 'string') return <>{p}</>;
  if ('b' in p) return <b>{p.b}</b>;
  return <span className="a">→</span>;
}

function Kv({ k, before, after, sub }: KvRow) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">
        {before}
        <span className="a">→</span>
        <b>{after}</b>
      </span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

function ChainRow({ c }: { c: Chain }) {
  if (c.kind === 'text') return <div className="chain">{c.text}</div>;
  return (
    <div className="chain">
      {c.parts.map((p, i) => (
        <Part key={i} p={p} />
      ))}
      <span className="d">{c.dates}</span>
    </div>
  );
}

export function AddMoreCard({ model, open, onToggle }: { model: CardModel; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Expanding brings the whole card into view inside the order panel's scrolling body (as a user would scroll).
  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }));
  }, [open]);
  return (
    <div ref={ref} className={`amc${model.variant === 'reentry' ? ' reentry' : ''}${open ? ' open' : ''}`} data-variant={model.variant}>
      <div
        className="head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="ico" />
        <span className="ttl">
          {model.title}
          {model.headerSub ? <small>{model.headerSub}</small> : null}
        </span>
        <span className="right">
          <span className="sum">
            <Rich segs={model.headerRight} />
          </span>
          <span className="arrow">▾</span>
        </span>
      </div>
      <div className="body">
        <div className="lead">
          <Rich segs={model.lead} />
        </div>
        {model.stats ? (
          <div className="stat2">
            {model.stats.map(s => (
              <div key={s.label}>
                <div className="l">{s.label}</div>
                <div className={`n ${s.tone === 'flat' ? '' : s.tone}`}>{s.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {model.why ? <div className="why">{model.why}</div> : null}
        {model.rows.map(r => (
          <Kv key={r.k} {...r} />
        ))}
        {model.notice ? <div className="notice">{model.notice}</div> : null}
        {model.chain ? <ChainRow c={model.chain} /> : null}
        <div className="foot">
          <span className="i" title={model.footer.tooltip}>
            i
          </span>
          {model.footer.text}
        </div>
      </div>
    </div>
  );
}
