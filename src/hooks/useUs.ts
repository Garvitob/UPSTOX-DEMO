'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useJson } from './useJson';
import { usBuyHistory, type BuyHistory } from '@/lib/compute';
import { istDate } from '@/lib/format';
import type { FxPayload, UsFillsPayload, UsPositionsPayload, UsPricePayload } from '@/lib/types';

// US tab data: Alpaca PAPER position + fills + latest IEX price, Upstox live USD/INR, and the USD/INR daily close
// on each buy date (per-lot FX). Loaded only once the US tab has been opened.
export interface UsData {
  positions: UsPositionsPayload | null;
  fills: UsFillsPayload | null;
  price: UsPricePayload | null;
  fx: FxPayload | null;
  history: BuyHistory | null;
  fxByDate: Record<string, FxPayload>;
  loading: boolean;
}

/** enabled = load at all (prefetch); active = the US tab is open, so keep refreshing. */
export function useUsData(enabled: boolean, active: boolean): UsData {
  const positions = useJson<UsPositionsPayload>(enabled ? '/api/us/positions' : null, active ? 60_000 : undefined);
  const symbol = positions.data?.symbol ?? null;
  const fills = useJson<UsFillsPayload>(enabled && symbol ? `/api/us/fills?symbol=${symbol}` : null, active ? 60_000 : undefined);
  // IEX price every 5 s while the US market is open (per the Alpaca clock in the same response), else every 60 s.
  const [usOpen, setUsOpen] = useState(false);
  const price = useJson<UsPricePayload>(enabled && symbol ? `/api/us/price?symbol=${symbol}` : null, active ? (usOpen ? 5_000 : 60_000) : undefined);
  useEffect(() => setUsOpen(!!price.data?.market?.is_open), [price.data]);
  const fx = useJson<FxPayload>(enabled ? '/api/fx' : null, active ? 20_000 : undefined);

  const pos = positions.data?.position ?? null;
  const history = useMemo(() => (pos && fills.data && fills.data.source === 'live' ? usBuyHistory(fills.data.fills, pos.qty) : null), [pos, fills.data]);
  const dates = useMemo(() => [...new Set((history?.lots ?? []).map(l => istDate(Date.parse(l.date))))].sort(), [history]);
  const [fxByDate, setFxByDate] = useState<Record<string, FxPayload>>({});

  // A request that fails in transport is stored as a labelled "unavailable" rate (the card then shows its
  // INR_UNAVAILABLE_FX notice instead of disappearing) and is tried again on a later refresh, after 60 s.
  const failedAt = useRef<Record<string, number>>({});
  // A fill dated today gets Upstox's live rate (its daily close does not exist yet); ask again every 10 min so the
  // lot switches to the day's close as soon as Upstox has it.
  const fetchedAt = useRef<Record<string, number>>({});
  useEffect(() => {
    const live = (d: string) => (fxByDate[d]?.basis === 'feed' || fxByDate[d]?.basis === 'intraday') && Date.now() - (fetchedAt.current[d] ?? 0) > 10 * 60_000;
    const retry = (d: string) => (fxByDate[d]?.error?.code === 'network' && Date.now() - (failedAt.current[d] ?? 0) > 60_000) || live(d);
    const missing = dates.filter(d => !fxByDate[d] || retry(d));
    if (missing.length === 0) return;
    let alive = true;
    const one = (d: string): Promise<FxPayload> =>
      fetch(`/api/fx?date=${d}`, { cache: 'no-store' })
        .then(r => {
          if (!(r.headers.get('content-type') ?? '').includes('application/json')) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<FxPayload>;
        })
        .catch((e: Error): FxPayload => {
          failedAt.current[d] = Date.now();
          return { source: 'unavailable', instrument_key: null, rate: null, basis: null, as_of: null, date: null, requested_date: d, error: { code: 'network', message: e.message } };
        });
    void Promise.all(missing.map(one)).then(rs => {
      if (!alive) return;
      missing.forEach(d => (fetchedAt.current[d] = Date.now()));
      setFxByDate(prev => {
        const next = { ...prev };
        missing.forEach((d, i) => (next[d] = rs[i]));
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [dates, fxByDate]);

  return {
    positions: positions.data,
    fills: fills.data,
    price: price.data,
    fx: fx.data,
    history,
    fxByDate,
    loading: positions.loading || (!!symbol && (fills.loading || (price.loading && !price.data))),
  };
}
