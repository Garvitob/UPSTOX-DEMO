'use client';
import { useCallback, useEffect, useState } from 'react';

const RETRIES = 3; // transport failures (network, HTML error page during a recompile) retry after 1 s, 2 s, 4 s

/**
 * Fetch JSON from one of our /api routes. `url = null` skips the request. Transport failures are retried with
 * backoff; a non-2xx JSON answer sets `error` and keeps the last good value (our routes still return labelled
 * payloads for upstream failures, with HTTP 200). `error` and `loading` always describe the current `url`, so a
 * previous URL's failure never shows for a new one, not even for the first render after the URL changes.
 */
export function useJson<T>(url: string | null, refreshMs?: number): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ url: string; message: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [doneUrl, setDoneUrl] = useState<string | null>(null); // the URL whose latest request has finished
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (n: number) => {
      fetch(url, { cache: 'no-store' })
        .then(async r => {
          if (!(r.headers.get('content-type') ?? '').includes('application/json')) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as T;
          if (!alive) return;
          if (r.ok) {
            setData(j);
            setError(null);
          } else setError({ url, message: `HTTP ${r.status}` });
          setLoading(false);
          setDoneUrl(url);
        })
        .catch((e: Error) => {
          if (!alive) return;
          if (n < RETRIES) {
            timer = setTimeout(() => attempt(n + 1), 1000 * 2 ** n);
            return;
          }
          setError({ url, message: e.message });
          setLoading(false);
          setDoneUrl(url);
        });
    };
    setLoading(true);
    attempt(0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, tick]);

  useEffect(() => {
    if (!url || !refreshMs) return;
    const id = setInterval(() => setTick(t => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [url, refreshMs]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return {
    data,
    error: error && error.url === url ? error.message : null,
    loading: !!url && (loading || doneUrl !== url),
    reload,
  };
}
