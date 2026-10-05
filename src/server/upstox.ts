import 'server-only';
import { config, MissingEnvError, need, type EnvKey } from './env';
import type { ApiError } from '@/lib/types';

// Fetch wrapper for the Upstox Developer API: picks the right token, retries 429 with exponential backoff,
// reports 401/403 as "unauthorized" (the caller falls back to the cache), never logs a token.

export type TokenKind = 'analytics' | 'oauth' | 'sandbox';
const TOKEN_ENV: Record<TokenKind, EnvKey> = {
  analytics: 'UPSTOX_ANALYTICS_TOKEN', // market data: LTP v3, quotes, candles, feed, market status
  oauth: 'UPSTOX_ACCESS_TOKEN', // account data: holdings, trade history, positions, margin, profile
  sandbox: 'UPSTOX_SANDBOX_TOKEN', // order placement on the sandbox host only
};

export type Upstream<T> = { ok: true; status: number; json: T } | { ok: false; status: number; error: ApiError };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ErrorBody {
  status?: string;
  errors?: { errorCode?: string; error_code?: string; message?: string }[] | null;
}

function errorOf(json: unknown): { code?: string; message?: string; isError: boolean } {
  if (!json || typeof json !== 'object') return { isError: false };
  const b = json as ErrorBody;
  const e = Array.isArray(b.errors) ? b.errors[0] : undefined;
  return { code: e?.errorCode ?? e?.error_code, message: e?.message, isError: b.status === 'error' };
}

export interface UpstoxRequest {
  path: string; // e.g. "/v3/market-quote/ltp?instrument_key=..."
  token: TokenKind;
  method?: 'GET' | 'POST';
  base?: string; // defaults to https://api.upstox.com
  body?: unknown;
  timeoutMs?: number;
  retries?: number; // 429 retries
}

export async function upstoxRequest<T>(req: UpstoxRequest): Promise<Upstream<T>> {
  let token: string;
  try {
    token = need(TOKEN_ENV[req.token]);
  } catch (e) {
    if (e instanceof MissingEnvError) return { ok: false, status: 0, error: { code: 'missing_env', message: e.message, key: e.key } };
    throw e;
  }
  const url = (req.base ?? config.upstoxBase) + req.path;
  const retries = req.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 10_000);
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method: req.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      text = await res.text(); // the body read is covered by the same timeout
    } catch (e) {
      const why = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message;
      return { ok: false, status: 0, error: { code: 'network', message: `Upstox unreachable (${why})` } };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 5) * 1000 : 500 * 2 ** attempt); // 0.5 s, 1 s, 2 s; never > 5 s
      continue;
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const err = errorOf(json);
    if (res.ok && !err.isError) {
      if (json === null || typeof json !== 'object') {
        return { ok: false, status: res.status, error: { code: 'upstream', message: `HTTP ${res.status} with an empty or non-JSON body`, status: res.status } };
      }
      return { ok: true, status: res.status, json: json as T };
    }
    const code = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'upstream';
    return {
      ok: false,
      status: res.status,
      error: { code, message: err.message ?? `HTTP ${res.status}`, status: res.status, upstream_code: err.code },
    };
  }
}

/** Instrument keys go into query strings encoded one by one, joined with literal commas. */
export const keyList = (keys: string[]): string => keys.map(encodeURIComponent).join(',');
