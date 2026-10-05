'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError, LtpPayload, MarketStatus, Quote, StreamEvent } from '@/lib/types';

// Live prices for a set of Upstox instrument keys:
// 1. one LTP v3 snapshot (+ last trade time) from /api/ltp,
// 2. ticks over /api/stream (SSE fed by the server's Upstox WebSocket client),
// 3. if the feed has been down for more than 10 s, poll /api/ltp every 2 s (never faster) until it is back.
// Outside market hours the feed sends only its snapshot; prices then equal LTP v3 and the UI says "Last traded …".

export type FeedState = 'connecting' | 'connected' | 'down';
export interface LiveQuote extends Quote {
  via: 'snapshot' | 'feed' | 'poll';
  at: number; // when the browser received it
}
export interface LiveState {
  quotes: Record<string, LiveQuote>;
  market: MarketStatus | null; // NSE
  markets: Record<'NSE' | 'BSE', MarketStatus | null>; // each exchange's own status
  feed: FeedState;
  polling: boolean;
  loaded: boolean;
  error: string | null;
}

/** ARCHITECTURE "Error handling" wording for the market-data banner, by cause. */
function describe(e: ApiError): string {
  if (e.code === 'missing_env') return `${e.key ?? 'UPSTOX_ANALYTICS_TOKEN'} is not set in .env.local — see HUMAN_TODO.md.`;
  if (e.code === 'unauthorized') return `Analytics token not accepted (${e.message}) — see HUMAN_TODO.md.`;
  if (e.code === 'rate_limited') return 'Rate limited, retrying.';
  if (e.code === 'network') return 'Upstox unreachable, showing last value.';
  return e.message;
}

const POLL_MS = 2000;
const DOWN_BEFORE_POLL_MS = 10_000;

export function useLivePrices(keys: string[]): LiveState {
  const keyStr = useMemo(() => [...new Set(keys)].sort().join(','), [keys]);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [markets, setMarkets] = useState<Record<'NSE' | 'BSE', MarketStatus | null>>({ NSE: null, BSE: null });
  const [feed, setFeed] = useState<FeedState>('connecting');
  const [polling, setPolling] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const downSince = useRef<number | null>(Date.now());

  const merge = (incoming: Record<string, Quote>, via: LiveQuote['via']) =>
    setQuotes(prev => {
      const next = { ...prev };
      for (const [k, q] of Object.entries(incoming)) next[k] = { ...q, ltt: q.ltt ?? prev[k]?.ltt ?? null, via, at: Date.now() };
      return next;
    });

  // 1. snapshot
  useEffect(() => {
    if (!keyStr) return;
    let alive = true;
    fetch(`/api/ltp?keys=${encodeURIComponent(keyStr)}&ltt=1`, { cache: 'no-store' })
      .then(r => r.json() as Promise<LtpPayload>)
      .then(j => {
        if (!alive) return;
        merge(j.quotes ?? {}, 'snapshot');
        if (j.markets) setMarkets(m => ({ NSE: j.markets.NSE ?? m.NSE, BSE: j.markets.BSE ?? m.BSE }));
        setError(j.error ? describe(j.error) : null);
        setLoaded(true);
      })
      .catch(e => alive && (setError((e as Error).message), setLoaded(true)));
    return () => {
      alive = false;
    };
  }, [keyStr]);

  // 2. stream
  useEffect(() => {
    if (!keyStr) return;
    const es = new EventSource(`/api/stream?keys=${encodeURIComponent(keyStr)}`);
    es.onmessage = m => {
      let e: StreamEvent;
      try {
        e = JSON.parse(m.data) as StreamEvent;
      } catch {
        return;
      }
      if (e.type === 'tick') {
        merge({ [e.key]: { instrument_key: e.key, last_price: e.ltp, cp: e.cp, ltt: e.ltt } }, 'feed');
        setError(null); // prices are flowing again
      }
      else if (e.type === 'status') {
        setFeed(e.feed);
        downSince.current = e.feed === 'connected' ? null : downSince.current ?? Date.now();
      } else if (e.type === 'market' && (e.segment === 'NSE_EQ' || e.segment === 'BSE_EQ')) {
        const ex = e.segment === 'NSE_EQ' ? 'NSE' : 'BSE';
        setMarkets(m => ({ ...m, [ex]: { exchange: ex, status: e.status, open: e.status === 'NORMAL_OPEN', last_updated: Date.now() } }));
      }
    };
    es.onerror = () => {
      setFeed('down');
      downSince.current = downSince.current ?? Date.now();
    };
    return () => es.close();
  }, [keyStr]);

  // 3. polling fallback while the feed is down
  useEffect(() => {
    if (!keyStr) return;
    let busy = false;
    const id = setInterval(() => {
      const down = downSince.current !== null && Date.now() - downSince.current > DOWN_BEFORE_POLL_MS;
      setPolling(down);
      if (!down || busy) return;
      busy = true;
      fetch(`/api/ltp?keys=${encodeURIComponent(keyStr)}`, { cache: 'no-store' })
        .then(r => r.json() as Promise<LtpPayload>)
        .then(j => {
          merge(j.quotes ?? {}, 'poll');
          if (j.markets) setMarkets(m => ({ NSE: j.markets.NSE ?? m.NSE, BSE: j.markets.BSE ?? m.BSE }));
          if (j.error && !Object.keys(j.quotes ?? {}).length) setError(describe(j.error));
          else if (Object.keys(j.quotes ?? {}).length) setError(null);
        })
        .catch(e => setError((e as Error).message))
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [keyStr]);

  return { quotes, market: markets.NSE, markets, feed, polling, loaded, error };
}
